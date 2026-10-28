-- Panel podpory, fáze 1 (Šimon 28. 10., DS Support): případy, časová osa, měření času,
-- omezení účtu s odůvodněním a záznam akcí. Všechno vidí a mění jen správci.

-- ---------------------------------------------------------------------------
-- 1. Případy
-- ---------------------------------------------------------------------------
create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  number int generated always as identity unique,
  kind text not null check (kind in ('report', 'question', 'appeal', 'content', 'other')),
  subject text not null check (char_length(subject) between 3 and 200),
  -- open = řeší podpora, waiting = čeká na uživatele, resolved = vyřešeno
  status text not null default 'open' check (status in ('open', 'waiting', 'resolved')),
  priority text not null default 'mid' check (priority in ('high', 'mid', 'low')),
  assignee_id uuid,
  due_at timestamptz,
  user_id uuid,
  other_id uuid,
  -- kontakt na člověka bez účtu (dotaz e-mailem nebo telefonem)
  contact_email text check (char_length(contact_email) <= 200),
  order_id uuid,
  report_id uuid unique,
  last_event text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index support_cases_open_idx on public.support_cases (status, due_at) where status <> 'resolved';
create index support_cases_user_idx on public.support_cases (user_id);
create index support_cases_other_idx on public.support_cases (other_id);
alter table public.support_cases enable row level security;
grant select, insert, update on public.support_cases to authenticated;
create policy "případy čtou správci" on public.support_cases for select to authenticated using (public.is_admin());
create policy "případy zakládají správci" on public.support_cases for insert to authenticated
  with check (public.is_admin() and public.mfa_ok());
create policy "případy mění správci" on public.support_cases for update to authenticated
  using (public.is_admin()) with check (public.is_admin() and public.mfa_ok());

-- note = interní poznámka, email = odeslaná odpověď, user = zpráva uživatele, event = událost
create table public.case_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.support_cases(id),
  kind text not null check (kind in ('note', 'email', 'user', 'event')),
  author_id uuid,
  recipients text check (char_length(recipients) <= 500),
  body text not null check (char_length(body) between 1 and 8000),
  created_at timestamptz not null default now()
);
create index case_events_case_idx on public.case_events (case_id, created_at);
alter table public.case_events enable row level security;
grant select, insert on public.case_events to authenticated;
create policy "osu případu čtou správci" on public.case_events for select to authenticated using (public.is_admin());
create policy "do osy píšou správci" on public.case_events for insert to authenticated
  with check (public.is_admin() and public.mfa_ok() and author_id = auth.uid() and kind in ('note', 'email', 'event'));

-- Poslední událost a čas změny pro frontu.
create or replace function public.case_event_touch() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  update public.support_cases
  set last_event = left(case new.kind when 'note' then 'Poznámka: ' when 'email' then 'E-mail: ' else '' end
        || regexp_replace(new.body, '\s+', ' ', 'g'), 140),
      updated_at = now()
  where id = new.case_id;
  return new;
end;
$$;
create trigger case_events_touch after insert on public.case_events
  for each row execute function public.case_event_touch();

-- Termín podle typu a priority. Víkendy se počítají, podpora pracuje i o víkendu.
create or replace function public.case_due(p_kind text, p_priority text) returns timestamptz
  language sql stable set search_path = '' as $$
  select now() + case when p_kind = 'appeal' then interval '7 days'
    when p_priority = 'high' then interval '1 day' else interval '2 days' end;
$$;
grant execute on function public.case_due(text, text) to authenticated;

create or replace function public.case_code(p_number int) returns text
  language sql immutable set search_path = '' as $$ select 'P-' || lpad(p_number::text, 4, '0'); $$;
grant execute on function public.case_code(int) to authenticated;

-- Měření času: na člověka vždy běží nejvýš jeden časovač.
create table public.case_time (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.support_cases(id),
  staff_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text check (char_length(note) <= 200),
  auto_stopped boolean not null default false,
  check (ended_at is null or ended_at >= started_at)
);
create unique index case_time_running on public.case_time (staff_id) where ended_at is null;
create index case_time_case_idx on public.case_time (case_id);
create index case_time_week_idx on public.case_time (started_at);
alter table public.case_time enable row level security;
grant select, insert, update on public.case_time to authenticated;
create policy "čas čtou správci" on public.case_time for select to authenticated using (public.is_admin());
create policy "svůj čas zapisuje správce" on public.case_time for insert to authenticated
  with check (public.is_admin() and public.mfa_ok() and staff_id = auth.uid());
create policy "svůj čas upravuje správce" on public.case_time for update to authenticated
  using (public.is_admin() and staff_id = auth.uid()) with check (public.is_admin() and staff_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Hlášení předané podpoře založí případ, odpovědi stran se zapisují do osy
-- ---------------------------------------------------------------------------
create or replace function public.report_to_case() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  c public.support_cases;
  v_prio text;
  v_reason text;
  v_code text := public.report_code(new.number);
begin
  select * into c from public.support_cases where report_id = new.id;
  v_prio := case when new.reason in ('paid_cancelled', 'not_delivered') then 'high' else 'mid' end;

  if new.status = 'review' and (tg_op = 'INSERT' or old.status <> 'review') then
    if c.id is null then
      v_reason := case new.reason
        when 'paid_cancelled' then 'Zaplatil(a) jsem a prodejce zrušil'
        when 'not_delivered' then 'Zaplatil(a) jsem a karta nepřišla'
        when 'not_as_described' then 'Karta neodpovídá popisu'
        when 'buyer_not_paid' then 'Kupující nezaplatil'
        when 'buyer_not_collected' then 'Kupující nepřevzal zásilku'
        else 'Jiný problém' end;
      insert into public.support_cases (kind, subject, priority, due_at, user_id, other_id, order_id, report_id, created_at)
      values ('report', v_reason || ' (' || v_code || ')', v_prio, public.case_due('report', v_prio),
        new.reporter_id, new.against_id, new.order_id, new.id, new.created_at)
      returning * into c;
      insert into public.case_events (case_id, kind, author_id, body, created_at)
      values (c.id, 'user', new.reporter_id, new.description, new.created_at);
      if tg_op = 'UPDATE' then
        insert into public.case_events (case_id, kind, body)
        values (c.id, 'event', 'Strany se nedohodly, hlášení ' || v_code || ' předáno podpoře');
      end if;
    else
      update public.support_cases set status = 'open', resolved_at = null,
        due_at = public.case_due('report', priority) where id = c.id;
      insert into public.case_events (case_id, kind, body)
      values (c.id, 'event', 'Hlášení ' || v_code || ' znovu předáno podpoře');
    end if;
    return new;
  end if;

  if c.id is null or tg_op = 'INSERT' then return new; end if;

  if new.against_note_at is distinct from old.against_note_at and new.against_note is not null then
    insert into public.case_events (case_id, kind, author_id, body)
    values (c.id, 'user', new.against_id, new.against_note);
    if c.status <> 'open' then
      update public.support_cases set status = 'open', resolved_at = null,
        due_at = public.case_due(c.kind, c.priority) where id = c.id;
    end if;
  end if;
  if new.support_note_at is distinct from old.support_note_at and new.support_note is not null then
    insert into public.case_events (case_id, kind, author_id, body)
    values (c.id, 'event', auth.uid(), 'Vyjádření podpory v hlášení: ' || new.support_note);
  end if;
  if new.status = 'closed' and old.status <> 'closed' then
    insert into public.case_events (case_id, kind, author_id, body)
    values (c.id, 'event', auth.uid(), 'Hlášení ' || v_code || ' uzavřeno' || case new.outcome
      when 'agreement' then ' dohodou' when 'withdrawn' then ', nahlašující ho odvolal'
      when 'no_agreement' then ' bez dohody' when 'violation' then ' jako porušení podmínek'
      when 'resolved' then ' jako vyřešené' else '' end);
  end if;
  return new;
end;
$$;
create trigger reports_to_case after insert or update on public.reports
  for each row execute function public.report_to_case();

create or replace function public.report_file_to_case() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  c public.support_cases;
begin
  select * into c from public.support_cases where report_id = new.report_id;
  if c.id is null then return new; end if;
  insert into public.case_events (case_id, kind, author_id, body)
  values (c.id, 'user', new.uploader_id, 'Příloha: ' || new.name);
  if c.status = 'waiting' then
    update public.support_cases set status = 'open', due_at = public.case_due(c.kind, c.priority) where id = c.id;
  end if;
  return new;
end;
$$;
create trigger report_files_to_case after insert on public.report_files
  for each row execute function public.report_file_to_case();

-- Hlášení, která už podpora prověřuje, dostanou případ hned.
with r as (
  select * from public.reports where status = 'review' order by created_at
), ins as (
  insert into public.support_cases (kind, subject, priority, due_at, user_id, other_id, order_id, report_id, created_at)
  select 'report',
    case r.reason when 'paid_cancelled' then 'Zaplatil(a) jsem a prodejce zrušil'
      when 'not_delivered' then 'Zaplatil(a) jsem a karta nepřišla'
      when 'not_as_described' then 'Karta neodpovídá popisu'
      when 'buyer_not_paid' then 'Kupující nezaplatil'
      when 'buyer_not_collected' then 'Kupující nepřevzal zásilku'
      else 'Jiný problém' end || ' (' || public.report_code(r.number) || ')',
    case when r.reason in ('paid_cancelled', 'not_delivered') then 'high' else 'mid' end,
    public.case_due('report', case when r.reason in ('paid_cancelled', 'not_delivered') then 'high' else 'mid' end),
    r.reporter_id, r.against_id, r.order_id, r.id, r.created_at
  from r
  returning id, report_id
)
insert into public.case_events (case_id, kind, author_id, body, created_at)
select ins.id, 'user', r.reporter_id, r.description, r.created_at
from ins join public.reports r on r.id = ins.report_id;

-- ---------------------------------------------------------------------------
-- 3. Záznam akcí: nejde upravit ani smazat
-- ---------------------------------------------------------------------------
create table public.staff_actions (
  id bigint generated always as identity primary key,
  staff_id uuid,
  user_id uuid,
  case_id uuid,
  action text not null check (action in ('warning', 'hide_listings', 'suspend', 'ban', 'lift', 'expired', 'plan', 'verify')),
  reason_code text check (char_length(reason_code) <= 40),
  facts text check (char_length(facts) <= 4000),
  until timestamptz,
  detail text check (char_length(detail) <= 300),
  created_at timestamptz not null default now()
);
create index staff_actions_user_idx on public.staff_actions (user_id, created_at desc);
create index staff_actions_time_idx on public.staff_actions (created_at desc);
alter table public.staff_actions enable row level security;
grant select on public.staff_actions to authenticated;
create policy "záznam akcí čtou správci" on public.staff_actions for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Omezení účtu
-- ---------------------------------------------------------------------------
-- hidden = skryté nabídky, suspended = pozastavený účet, banned = zrušený účet (pozastavený bez konce)
create table public.account_restrictions (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null check (kind in ('hidden', 'suspended', 'banned')),
  until timestamptz,
  case_id uuid references public.support_cases(id),
  set_by uuid,
  set_at timestamptz not null default now(),
  -- konec omezení (zrušené správcem nebo uplynutím doby); ukončené řádky zůstávají jako historie
  ended_at timestamptz
);
create unique index account_restrictions_active on public.account_restrictions (user_id) where ended_at is null;
alter table public.account_restrictions enable row level security;
grant select on public.account_restrictions to authenticated;
create policy "omezení vidí správci a dotčený" on public.account_restrictions for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

-- Skrytá nabídka má množství odložené v hidden_qty a na webu má 0 kusů.
alter table public.listings add column hidden_qty int check (hidden_qty >= 0);

-- Dokud je nabídka skrytá, každé navýšení (uvolněná rezervace, úprava) jde do odloženého množství.
create or replace function public.listing_keep_hidden() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.hidden_qty is not null and old.hidden_qty is not null and new.quantity > 0 then
    new.hidden_qty := new.hidden_qty + new.quantity;
    new.quantity := 0;
  end if;
  return new;
end;
$$;
create trigger listings_keep_hidden before update on public.listings
  for each row execute function public.listing_keep_hidden();

-- Při skrytí nabídky se do chatu nepíše „se prodala“.
create or replace function public.close_offers_sold_out() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  o public.price_offers;
  v_name text;
begin
  if new.quantity > 0 or old.quantity = 0 or new.hidden_qty is not null then return new; end if;
  v_name := public.offer_card_name(new.id);
  for o in update public.price_offers set status = 'sold_out', updated_at = now()
           where listing_id = new.id and status = 'open' returning * loop
    perform public.offer_chat(o, null, 'Karta ' || v_name || ' se prodala, návrh ceny skončil', null);
  end loop;
  return new;
end;
$$;

create or replace function public.account_restriction(p_user uuid) returns text
  language sql stable security definer set search_path = '' as $$
  select kind from public.account_restrictions where user_id = p_user and ended_at is null and (until is null or until > now());
$$;
revoke execute on function public.account_restriction(uuid) from public, anon, authenticated;

-- Omezený účet nevystavuje, pozastavený ani nekupuje a nenavrhuje ceny. Rozpracované objednávky dokončí.
create or replace function public.guard_restricted_listing() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if public.account_restriction(new.seller_id) is not null then
    raise exception 'Vystavování máte omezené, napište na podpora@v4cards.com';
  end if;
  return new;
end;
$$;
create trigger listings_guard_restricted before insert on public.listings
  for each row execute function public.guard_restricted_listing();

create or replace function public.guard_restricted_trade() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if public.account_restriction(new.buyer_id) in ('suspended', 'banned') then
    raise exception 'Váš účet je pozastavený, napište na podpora@v4cards.com';
  end if;
  if public.account_restriction(new.seller_id) is not null then
    raise exception 'Prodejce teď nepřijímá objednávky';
  end if;
  return new;
end;
$$;
create trigger orders_guard_restricted before insert on public.orders
  for each row execute function public.guard_restricted_trade();
create trigger price_offers_guard_restricted before insert on public.price_offers
  for each row execute function public.guard_restricted_trade();

create or replace function public.hide_user_listings(p_user uuid) returns void
  language sql security definer set search_path = '' as $$
  update public.listings set hidden_qty = quantity, quantity = 0 where seller_id = p_user and hidden_qty is null;
$$;
revoke execute on function public.hide_user_listings(uuid) from public, anon, authenticated;

create or replace function public.restore_user_listings(p_user uuid) returns void
  language sql security definer set search_path = '' as $$
  update public.listings set quantity = quantity + hidden_qty, hidden_qty = null where seller_id = p_user and hidden_qty is not null;
$$;
revoke execute on function public.restore_user_listings(uuid) from public, anon, authenticated;

-- Opatření správce. Odůvodnění e-mailem posílá web po úspěchu, tady se vše zapíše do záznamu akcí.
create or replace function public.admin_restrict(p_user uuid, p_action text, p_reason text, p_facts text, p_days int, p_case uuid)
  returns bigint
  language plpgsql security definer set search_path = '' as $$
declare
  v_until timestamptz;
  v_facts text := nullif(left(trim(coalesce(p_facts, '')), 4000), '');
  v_id bigint;
  v_kind text;
begin
  if not public.is_admin() or not public.mfa_ok() then raise exception 'Omezit účet může jen správce'; end if;
  if p_action not in ('warning', 'hide_listings', 'suspend', 'ban', 'lift') then raise exception 'Neznámé opatření'; end if;
  if p_user = auth.uid() then raise exception 'Vlastní účet omezit nejde'; end if;
  if exists (select 1 from public.admins where user_id = p_user) then raise exception 'Účet správce omezit nejde'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Uživatel neexistuje'; end if;
  if p_action <> 'lift' and (v_facts is null or char_length(v_facts) < 20) then
    raise exception 'Popište skutečnosti, ze kterých vycházíte (uvidí je uživatel)';
  end if;
  if p_action <> 'lift' and nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Vyberte důvod podle podmínek'; end if;
  if p_days is not null and (p_days < 1 or p_days > 365) then raise exception 'Doba omezení je 1 až 365 dní'; end if;
  v_until := case when p_action in ('hide_listings', 'suspend') and p_days is not null then now() + make_interval(days => p_days) end;

  if p_action = 'lift' then
    update public.account_restrictions set ended_at = now() where user_id = p_user and ended_at is null;
    if not found then raise exception 'Účet není omezený'; end if;
    perform public.restore_user_listings(p_user);
  elsif p_action in ('hide_listings', 'suspend', 'ban') then
    v_kind := case p_action when 'hide_listings' then 'hidden' when 'suspend' then 'suspended' else 'banned' end;
    update public.account_restrictions set ended_at = now() where user_id = p_user and ended_at is null;
    insert into public.account_restrictions (user_id, kind, until, case_id, set_by)
      values (p_user, v_kind, v_until, p_case, auth.uid());
    perform public.hide_user_listings(p_user);
  end if;

  insert into public.staff_actions (staff_id, user_id, case_id, action, reason_code, facts, until)
    values (auth.uid(), p_user, p_case, p_action, nullif(trim(coalesce(p_reason, '')), ''), v_facts, v_until)
    returning id into v_id;
  if p_case is not null then
    insert into public.case_events (case_id, kind, author_id, body)
    values (p_case, 'event', auth.uid(), case p_action
      when 'warning' then 'Uživatel upozorněn e-mailem'
      when 'hide_listings' then 'Skryty všechny nabídky uživatele'
      when 'suspend' then 'Účet pozastaven'
      when 'ban' then 'Účet zrušen'
      else 'Omezení účtu zrušeno' end
      || coalesce(' do ' || to_char(v_until at time zone 'Europe/Prague', 'FMDD. FMMM. YYYY'), ''));
  end if;
  return v_id;
end;
$$;
revoke execute on function public.admin_restrict(uuid, text, text, text, int, uuid) from public, anon;
grant execute on function public.admin_restrict(uuid, text, text, text, int, uuid) to authenticated;

-- Kupující smí zrušit potvrzenou objednávku, kterou ještě nezaplatil, když je prodejce pozastavený.
create or replace function public.set_order_status(target uuid, next_status public.order_status) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  me uuid := auth.uid();
  pay text;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found then raise exception 'Objednávka neexistuje'; end if;
  pay := coalesce(o.payment, 'transfer');

  if o.seller_id = me and o.status = 'requested' and next_status in ('confirmed', 'declined') then
    if o.expires_at < now() then raise exception 'Na objednávku už vypršel čas'; end if;
    update public.orders set status = next_status, decided_at = now() where id = target;
    if next_status = 'declined' then perform public.release_order_items(target); end if;
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'paid' and pay = 'transfer' and o.buyer_paid_at is not null then
    update public.orders set status = 'paid', cancel_request_at = null where id = target;
  elsif o.seller_id = me and o.delivery = 'ship' and next_status = 'shipped'
      and ((o.status = 'paid' and pay = 'transfer') or (o.status = 'confirmed' and pay = 'cod')) then
    update public.orders set status = 'shipped' where id = target;
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'delivered' and o.delivery = 'pickup' and pay = 'cash' then
    update public.orders set status = 'delivered', delivered_at = now() where id = target;
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'cancelled' then
    if o.buyer_paid_at is not null and now() < public.order_cancel_from(o) then
      raise exception 'Zrušit půjde až po čekací době, nebo se souhlasem kupujícího';
    end if;
    update public.orders set status = 'cancelled', cancel_request_at = null where id = target;
    perform public.release_order_items(target);
  elsif o.buyer_id = me and next_status = 'cancelled' and (o.status = 'requested'
      or (o.status = 'confirmed' and o.buyer_paid_at is null and public.account_restriction(o.seller_id) in ('suspended', 'banned'))) then
    update public.orders set status = 'cancelled', cancel_request_at = null where id = target;
    perform public.release_order_items(target);
  elsif o.buyer_id = me and next_status = 'delivered'
      and (o.status = 'shipped' or (o.status = 'paid' and o.delivery = 'pickup')) then
    update public.orders set status = 'delivered', delivered_at = now() where id = target;
  else
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
end;
$$;

-- Objednávky kupujícího, u kterých má vidět varování: prodejce je pozastavený a kupující ještě neklikl Zaplaceno.
create or replace function public.orders_seller_restricted(p_orders uuid[]) returns setof uuid
  language sql stable security definer set search_path = '' as $$
  select o.id from public.orders o
  where o.id = any(p_orders) and o.buyer_id = auth.uid()
    and o.status in ('requested', 'confirmed') and o.buyer_paid_at is null
    and public.account_restriction(o.seller_id) in ('suspended', 'banned');
$$;
revoke execute on function public.orders_seller_restricted(uuid[]) from public, anon;
grant execute on function public.orders_seller_restricted(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Údaje o uživatelích pro podporu
-- ---------------------------------------------------------------------------
create or replace function public.admin_staff() returns table (id uuid, name text)
  language sql stable security definer set search_path = '' as $$
  select a.user_id, p.display_name from public.admins a join public.profiles p on p.id = a.user_id
  where public.is_admin() order by p.display_name;
$$;
revoke execute on function public.admin_staff() from public, anon;
grant execute on function public.admin_staff() to authenticated;

create or replace function public.admin_user_emails(p_ids uuid[]) returns table (id uuid, email text)
  language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text from auth.users u where u.id = any(p_ids) and public.is_admin();
$$;
revoke execute on function public.admin_user_emails(uuid[]) from public, anon;
grant execute on function public.admin_user_emails(uuid[]) to authenticated;

-- Objednávky k případům (správce jinak cizí objednávky nevidí, ani ve vlastních seznamech).
create or replace function public.admin_orders(p_ids uuid[]) returns table (
  id uuid, number int, status text, buyer_id uuid, seller_id uuid, total_czk int, shipping_czk int,
  payment text, paid_via text, buyer_paid_at timestamptz, not_received_at timestamptz, cancel_agreed boolean,
  created_at timestamptz, delivered_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  select o.id, o.number, o.status::text, o.buyer_id, o.seller_id, o.total_czk, o.shipping_czk,
    o.payment, o.paid_via, o.buyer_paid_at, o.not_received_at, o.cancel_agreed, o.created_at, o.delivered_at
  from public.orders o where o.id = any(p_ids) and public.is_admin();
$$;
revoke execute on function public.admin_orders(uuid[]) from public, anon;
grant execute on function public.admin_orders(uuid[]) to authenticated;

-- Hledání podle přezdívky, e-mailu nebo id.
create or replace function public.admin_find_users(p_q text) returns table (id uuid, display_name text, email text, kind text)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, u.email::text, p.kind::text
  from public.profiles p join auth.users u on u.id = p.id
  where public.is_admin() and char_length(trim(p_q)) >= 2
    and (p.display_name ilike '%' || trim(p_q) || '%' or u.email ilike '%' || trim(p_q) || '%' or p.id::text = trim(p_q))
  order by p.display_name limit 30;
$$;
revoke execute on function public.admin_find_users(text) from public, anon;
grant execute on function public.admin_find_users(text) to authenticated;

create or replace function public.admin_user_info(p_user uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.is_admin() then raise exception 'Jen pro správce'; end if;
  select jsonb_build_object(
    'email', u.email,
    'created_at', u.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
    'plan', (select s.plan from public.subscriptions s where s.user_id = u.id),
    'verified', (select s.method from public.seller_verifications s where s.user_id = u.id),
    'sold', (select count(*) from public.orders o where o.seller_id = u.id and o.status = 'delivered'),
    'bought', (select count(*) from public.orders o where o.buyer_id = u.id and o.status = 'delivered'),
    'reviews', (select count(*) from public.reviews r where r.seller_id = u.id),
    'reviews_positive', (select count(*) from public.reviews r where r.seller_id = u.id and r.rating >= 4),
    'cancelled_after_paid', (select t.cancelled_after_paid from public.seller_trust(u.id) t),
    'disputes', (select t.disputes from public.seller_trust(u.id) t),
    'reports_against', (select count(*) from public.reports r where r.against_id = u.id),
    'listings', (select count(*) from public.listings l where l.seller_id = u.id and l.quantity > 0),
    'hidden', (select count(*) from public.listings l where l.seller_id = u.id and l.hidden_qty > 0),
    'restriction', (select jsonb_build_object('kind', r.kind, 'until', r.until, 'set_at', r.set_at)
      from public.account_restrictions r where r.user_id = u.id and r.ended_at is null)
  ) into v
  from auth.users u where u.id = p_user;
  return v;
end;
$$;
revoke execute on function public.admin_user_info(uuid) from public, anon;
grant execute on function public.admin_user_info(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Každou hodinu: konec omezení a zapomenuté časovače
-- ---------------------------------------------------------------------------
create or replace function public.support_hourly() returns void
  language plpgsql security definer set search_path = '' as $$
declare
  r public.account_restrictions;
begin
  for r in update public.account_restrictions set ended_at = now()
           where ended_at is null and until is not null and until <= now() returning * loop
    perform public.restore_user_listings(r.user_id);
    insert into public.staff_actions (user_id, case_id, action, detail)
      values (r.user_id, r.case_id, 'expired', 'Omezení skončilo uplynutím doby');
    if r.case_id is not null then
      insert into public.case_events (case_id, kind, body) values (r.case_id, 'event', 'Omezení účtu skončilo uplynutím doby');
    end if;
  end loop;
  update public.case_time set ended_at = started_at + interval '2 hours', auto_stopped = true
  where ended_at is null and started_at < now() - interval '2 hours';
end;
$$;
revoke execute on function public.support_hourly() from public, anon, authenticated;
select cron.schedule('support-hourly', '17 * * * *', $$select public.support_hourly()$$);
