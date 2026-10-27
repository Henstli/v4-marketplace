-- Dotaz k nabídce: zpráva může odkazovat na konkrétní nabídku (karta, stav, jazyk, cena).
-- Změny stavu objednávky v chatu říkají, kdo je udělal („Kupující zrušil…“).

alter table public.messages add column listing_id uuid references public.listings(id) on delete set null;

-- Zpráva od přihlášeného uživatele, volitelně k nabídce jednoho z účastníků. Vrací id konverzace.
create or replace function public.send_message(p_to uuid, p_body text, p_listing uuid) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_conv uuid;
  v_id bigint;
begin
  if v_me is null then raise exception 'Pro psaní zpráv se přihlaste.'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření.'; end if;
  if p_to is null or p_to = v_me then raise exception 'Sám sobě zprávu poslat nejde.'; end if;
  if not exists (select 1 from public.profiles where id = p_to) then raise exception 'Uživatel neexistuje.'; end if;
  if v_body = '' then raise exception 'Zpráva je prázdná.'; end if;
  if char_length(v_body) > 2000 then raise exception 'Zpráva může mít nejvýš 2 000 znaků.'; end if;
  if p_listing is not null and not exists (
    select 1 from public.listings where id = p_listing and seller_id in (v_me, p_to)
  ) then raise exception 'Nabídka už neexistuje.'; end if;
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
  v_id := public.post_message(v_conv, v_me, 'text', v_body, null);
  if p_listing is not null then
    update public.messages set listing_id = p_listing where id = v_id;
  end if;
  return v_conv;
end;
$$;
revoke execute on function public.send_message(uuid, text, uuid) from public, anon;
grant execute on function public.send_message(uuid, text, uuid) to authenticated;

-- Původní podoba bez nabídky zůstává kvůli kompatibilitě.
create or replace function public.send_message(p_to uuid, p_body text) returns uuid
  language sql security definer set search_path = '' as $$
  select public.send_message(p_to, p_body, null::uuid);
$$;

create or replace function public.order_chat_event() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_conv uuid;
  v_body text;
  v_actor text := case auth.uid() when new.buyer_id then 'Kupující' when new.seller_id then 'Prodejce' else null end;
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
    when 'expired' then 'Prodejce nepotvrdil včas, vypršela objednávka č. '
    when 'cancelled' then coalesce(v_actor, 'Systém') || ' zrušil objednávku č. '
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
