-- Zprávy mezi kupujícím a prodejcem. Jedna konverzace na dvojici uživatelů,
-- objednávky mezi nimi se do ní propisují (nová objednávka, změny stavu).
-- Klient čte přes RLS, zapisuje jen přes funkce send_message a mark_conversation_read.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  -- Dvojice je seřazená (user_a < user_b), aby šla najít jedním dotazem. Smazaný účet = null,
  -- druhé straně historie zůstane.
  user_a uuid references public.profiles(id) on delete set null,
  user_b uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_sender uuid,
  last_body text not null default '',
  a_read_at timestamptz,
  b_read_at timestamptz,
  -- Kdy jsme naposledy poslali e-mail o nepřečtených zprávách (aby nechodil ke každé zprávě).
  a_emailed_at timestamptz,
  b_emailed_at timestamptz,
  check (user_a < user_b),
  unique (user_a, user_b)
);
create index conversations_a_idx on public.conversations (user_a, last_message_at desc);
create index conversations_b_idx on public.conversations (user_b, last_message_at desc);
alter table public.conversations enable row level security;
grant select on public.conversations to authenticated;
create policy "konverzace účastníků" on public.conversations for select to authenticated
  using (auth.uid() in (user_a, user_b));

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  -- text = zpráva od uživatele, order = nová objednávka, status = změna stavu objednávky
  kind text not null default 'text' check (kind in ('text', 'order', 'status')),
  body text not null check (char_length(body) between 1 and 2000),
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, id desc);
create index messages_sender_idx on public.messages (sender_id, created_at desc) where kind = 'text';
alter table public.messages enable row level security;
grant select on public.messages to authenticated;
create policy "zprávy účastníků" on public.messages for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)
  ));

-- Najde nebo založí konverzaci dvou uživatelů (jen pro funkce níže).
create or replace function public.conversation_for(p_one uuid, p_two uuid) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  v_a uuid := least(p_one, p_two);
  v_b uuid := greatest(p_one, p_two);
  v_id uuid;
begin
  insert into public.conversations (user_a, user_b) values (v_a, v_b)
    on conflict (user_a, user_b) do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from public.conversations where user_a = v_a and user_b = v_b;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.conversation_for(uuid, uuid) from public, anon, authenticated;

-- Vloží zprávu a posune konverzaci; odesílatel ji má rovnou přečtenou.
create or replace function public.post_message(p_conversation uuid, p_sender uuid, p_kind text, p_body text, p_order uuid)
  returns bigint
  language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  insert into public.messages (conversation_id, sender_id, kind, body, order_id)
    values (p_conversation, p_sender, p_kind, p_body, p_order)
    returning id into v_id;
  update public.conversations c set
    last_message_at = now(),
    last_sender = p_sender,
    last_body = left(p_body, 200),
    a_read_at = case when p_sender is not null and p_sender = c.user_a then now() else c.a_read_at end,
    b_read_at = case when p_sender is not null and p_sender = c.user_b then now() else c.b_read_at end
  where c.id = p_conversation;
  return v_id;
end;
$$;
revoke execute on function public.post_message(uuid, uuid, text, text, uuid) from public, anon, authenticated;

-- Zpráva od přihlášeného uživatele. Vrací id konverzace.
create or replace function public.send_message(p_to uuid, p_body text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_conv uuid;
begin
  if v_me is null then raise exception 'Pro psaní zpráv se přihlaste.'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření.'; end if;
  if p_to is null or p_to = v_me then raise exception 'Sám sobě zprávu poslat nejde.'; end if;
  if not exists (select 1 from public.profiles where id = p_to) then raise exception 'Uživatel neexistuje.'; end if;
  if v_body = '' then raise exception 'Zpráva je prázdná.'; end if;
  if char_length(v_body) > 2000 then raise exception 'Zpráva může mít nejvýš 2 000 znaků.'; end if;
  -- Ochrana proti spamu: nejvýš 60 zpráv za hodinu a 20 nových konverzací za den.
  if (select count(*) from public.messages
      where sender_id = v_me and kind = 'text' and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Posíláte příliš mnoho zpráv. Zkuste to prosím za chvíli.';
  end if;
  if not exists (select 1 from public.conversations where user_a = least(v_me, p_to) and user_b = greatest(v_me, p_to))
     and (select count(distinct m.conversation_id) from public.messages m
          join public.conversations c on c.id = m.conversation_id
          where m.sender_id = v_me and m.kind = 'text' and c.created_at > now() - interval '1 day'
            and m.id = (select min(id) from public.messages f where f.conversation_id = c.id)) >= 20 then
    raise exception 'Dnes jste založili příliš mnoho nových konverzací. Zkuste to prosím zítra.';
  end if;

  v_conv := public.conversation_for(v_me, p_to);
  perform public.post_message(v_conv, v_me, 'text', v_body, null);
  return v_conv;
end;
$$;
revoke execute on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

create or replace function public.mark_conversation_read(p_conversation uuid) returns void
  language sql security definer set search_path = '' as $$
  update public.conversations set
    a_read_at = case when user_a = auth.uid() then now() else a_read_at end,
    b_read_at = case when user_b = auth.uid() then now() else b_read_at end
  where id = p_conversation and auth.uid() in (user_a, user_b);
$$;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Počet konverzací s nepřečtenou zprávou od druhé strany (tečka v menu).
create or replace function public.unread_conversations() returns integer
  language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.conversations c
  where (c.user_a = auth.uid() and c.last_sender is distinct from auth.uid()
         and (c.a_read_at is null or c.a_read_at < c.last_message_at))
     or (c.user_b = auth.uid() and c.last_sender is distinct from auth.uid()
         and (c.b_read_at is null or c.b_read_at < c.last_message_at));
$$;
revoke execute on function public.unread_conversations() from public, anon;
grant execute on function public.unread_conversations() to authenticated;

-- Adresa příjemce pro e-mail o nové zprávě. Vrátí ji jen odesílateli poslední zprávy a jen
-- jednou za dávku nepřečtených (další e-mail až poté, co si příjemce zprávy přečte),
-- a ne když příjemce právě píše (četl v posledních 5 minutách).
create or replace function public.claim_message_email(p_conversation uuid)
  returns table (email text, sender_name text)
  language plpgsql security definer set search_path = '' as $$
declare
  c public.conversations;
  v_me uuid := auth.uid();
  v_to uuid;
  v_read timestamptz;
  v_mailed timestamptz;
begin
  select * into c from public.conversations where id = p_conversation for update;
  if not found or v_me is null or c.last_sender is distinct from v_me then return; end if;
  if c.user_a = v_me then v_to := c.user_b; v_read := c.b_read_at; v_mailed := c.b_emailed_at;
  elsif c.user_b = v_me then v_to := c.user_a; v_read := c.a_read_at; v_mailed := c.a_emailed_at;
  else return; end if;
  if v_to is null then return; end if;
  if v_mailed is not null and (v_read is null or v_read < v_mailed) then return; end if;
  if v_read is not null and v_read > now() - interval '5 minutes' then return; end if;
  update public.conversations set
    a_emailed_at = case when user_a = v_to then now() else a_emailed_at end,
    b_emailed_at = case when user_b = v_to then now() else b_emailed_at end
  where id = p_conversation;
  return query
    select u.email::text, p.display_name::text
    from auth.users u, public.profiles p
    where u.id = v_to and p.id = v_me;
end;
$$;
revoke execute on function public.claim_message_email(uuid) from public, anon;
grant execute on function public.claim_message_email(uuid) to authenticated;

-- Objednávky v konverzaci: nová objednávka od kupujícího a každá změna stavu.
-- Odesílatel změny je ten, kdo ji udělal (vypršení z cronu nemá odesílatele).
create or replace function public.order_chat_event() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_conv uuid;
  v_body text;
begin
  if new.buyer_id is null or new.seller_id is null then return new; end if;
  if tg_op = 'INSERT' then
    v_conv := public.conversation_for(new.buyer_id, new.seller_id);
    perform public.post_message(v_conv, new.buyer_id, 'order', 'Nová objednávka č. ' || new.number, new.id);
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  v_body := case new.status::text
    when 'confirmed' then 'Prodejce potvrdil objednávku č. '
    when 'declined' then 'Prodejce odmítl objednávku č. '
    when 'expired' then 'Vypršela nepotvrzená objednávka č. '
    when 'cancelled' then 'Zrušena objednávka č. '
    when 'paid' then 'Zaplacena objednávka č. '
    when 'shipped' then 'Prodejce odeslal objednávku č. '
    when 'delivered' then 'Kupující převzal objednávku č. '
    else null end;
  if v_body is null then return new; end if;
  v_conv := public.conversation_for(new.buyer_id, new.seller_id);
  perform public.post_message(v_conv, auth.uid(), 'status', v_body || new.number, new.id);
  return new;
end;
$$;

create trigger orders_chat_event after insert or update of status on public.orders
  for each row execute function public.order_chat_event();
