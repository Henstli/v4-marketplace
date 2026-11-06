-- Historie skladu a sbírky podle plátna (6. 11.):
--  * u každé změny karty a stav před/po (items) a dopad v Kč (impact_czk), počítá se při zápisu,
--  * vrácení vytvoří nový řádek „Vráceno: …“ propojený s původním (reverts_id), který jde znovu vrátit,
--  * hromadné vrácení nechá být karty, které se mezitím prodaly nebo jim někdo změnil cenu ručně,
--  * K prověření: pravidla Co hlídat (stock_watch) a nálezy (stock_flags), jen pro obchody.

alter table public.stock_events
  add column if not exists items jsonb,
  add column if not exists impact_czk integer,
  add column if not exists reverts_id bigint references public.stock_events(id) on delete set null,
  add column if not exists undone_by uuid,
  add column if not exists flag_checked boolean not null default false;

create index if not exists stock_events_items_idx on public.stock_events using gin (items jsonb_path_ops);
create index if not exists stock_events_reverts_idx on public.stock_events (reverts_id) where reverts_id is not null;

-- Stav každé karty před a po změně: l listing, c karta, p cena, q kusů celkem, s kusů na prodej, loc umístění.
create or replace function public.stock_items_of(p_undo jsonb) returns jsonb
  language sql stable set search_path to ''
as $$
  select jsonb_agg(jsonb_build_object(
      'l', b->>'id', 'c', b->>'card_id',
      'p0', (b->>'price_czk')::int, 'p1', l.price_czk,
      'q0', coalesce((b->>'total_before')::int, (b->>'quantity')::int + coalesce((b->>'keep_qty')::int, 0)),
      'q1', case when l.id is null then 0 else coalesce((b->>'total_after')::int, l.quantity + coalesce(s.keep_qty, 0)) end,
      's0', (b->>'quantity')::int, 's1', coalesce(l.quantity, 0),
      'loc0', b->>'location', 'loc1', s.location))
    from jsonb_array_elements(p_undo) b
    left join public.listings l on l.id = (b->>'id')::uuid
    left join public.listing_stock s on s.listing_id = l.id
   where jsonb_typeof(p_undo) = 'array'
$$;

-- Dopad v Kč: u cen rozdíl ceny × kusů na prodej, u kusů rozdíl hodnoty (cena × kusů).
create or replace function public.stock_impact_of(p_kind text, p_items jsonb) returns integer
  language sql immutable set search_path to ''
as $$
  select case when p_kind = 'price' then
      sum(case when x->>'p0' is not null and x->>'p1' is not null
               then ((x->>'p1')::int - (x->>'p0')::int) * greatest(coalesce((x->>'s1')::int, 0), 1) else 0 end)
    else
      sum(coalesce((x->>'p1')::int, (x->>'p0')::int, 0) * coalesce((x->>'q1')::int, 0)
        - coalesce((x->>'p0')::int, (x->>'p1')::int, 0) * coalesce((x->>'q0')::int, 0))
    end::int
    from jsonb_array_elements(p_items) x
$$;

create or replace function public.stock_events_fill() returns trigger
  language plpgsql security definer set search_path to ''
as $$
begin
  if new.items is null and new.undo is not null then
    new.items := public.stock_items_of(new.undo);
  end if;
  if new.impact_czk is null and new.items is not null then
    new.impact_czk := public.stock_impact_of(new.kind, new.items);
  end if;
  return new;
end;
$$;

create or replace trigger stock_events_fill before insert on public.stock_events
  for each row execute function public.stock_events_fill();

-- Dosavadní záznamy: karty a dopad podle dnešního stavu (přibližně, jde o pár zkušebních záznamů).
update public.stock_events set items = public.stock_items_of(undo)
 where items is null and undo is not null;
update public.stock_events set impact_czk = public.stock_impact_of(kind, items)
 where impact_czk is null and items is not null;

-- Odebrání karet jde nově také vrátit (kusy se vrátí, smazané řádky bez objednávek už ne).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.stock_change(uuid[], text, text, numeric, text, jsonb)'::regprocedure);
  if position('case when p_op = ''remove'' then null else' in d) > 0 then
    execute replace(d, 'case when p_op = ''remove'' then null else', 'case when false then null else');
  end if;
end $$;

-- Přidání karty jde vrátit a ví, o kterou kartu jde.
create or replace function public.stock_add_for(p_owner uuid, p_card uuid, p_condition card_condition, p_language text,
                                                p_price integer, p_keep integer, p_note text default null::text)
  returns uuid language plpgsql security definer set search_path to ''
as $function$
declare
  lid uuid;
begin
  if not public.stock_perm(p_owner, 'add') then raise exception 'Na přidávání karet nemáte právo' using errcode = '42501'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření' using errcode = '42501'; end if;
  if p_keep is null or p_keep < 1 or p_keep > 100000 then raise exception 'Počet kusů musí být aspoň 1'; end if;
  if p_price is not null and p_price <= 0 then raise exception 'Cena musí být kladná'; end if;
  insert into public.listings (card_id, seller_id, price_czk, negotiable, condition, language, quantity, note)
  values (p_card, p_owner, p_price, p_price is null, p_condition, p_language, 0, nullif(left(trim(coalesce(p_note, '')), 200), ''))
  returning id into lid;
  update public.listing_stock set keep_qty = p_keep, updated_at = now() where listing_id = lid;
  insert into public.stock_events (owner_id, actor_id, kind, title, undo)
  select p_owner, (select auth.uid()), 'stock', left('Přidáno: ' || c.name || ' · ' || p_keep || ' ks', 200),
         jsonb_build_array(jsonb_build_object('id', lid, 'card_id', p_card, 'price_czk', p_price, 'negotiable', p_price is null,
           'quantity', 0, 'keep_qty', 0, 'trade_qty', 0, 'location', null, 'total_before', 0, 'total_after', p_keep))
    from public.cards c where c.id = p_card;
  return lid;
end;
$function$;

-- Karty hromadné změny, které se od ní prodaly nebo je někdo změnil jinak: při vrácení zůstanou být.
create or replace function public.stock_undo_skips(p_event bigint) returns table(l uuid, why text)
  language sql stable security definer set search_path to ''
as $$
  select (x->>'id')::uuid,
         case when exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
                            where oi.listing_id = (x->>'id')::uuid and o.created_at > e.created_at) then 'sold' else 'manual' end
    from public.stock_events e cross join jsonb_array_elements(e.undo) x
   where e.id = p_event and jsonb_array_length(e.undo) > 1 and public.stock_perm(e.owner_id, 'view')
     and (exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
                   where oi.listing_id = (x->>'id')::uuid and o.created_at > e.created_at)
       or exists (select 1 from public.stock_events e2
                   where e2.owner_id = e.owner_id and e2.id <> e.id and e2.created_at > e.created_at
                     and e2.reverts_id is distinct from e.id and e2.undone_at is null
                     and e2.items @> jsonb_build_array(jsonb_build_object('l', x->>'id'))))
$$;

-- Náhled vrácení: co se vrátí a co zůstane (stays = sold / manual).
create or replace function public.stock_undo_preview(p_event bigint)
  returns table(l uuid, card_id uuid, p_now integer, p_back integer, q_now integer, q_back integer, stays text)
  language sql stable security definer set search_path to ''
as $$
  select (x->>'id')::uuid, (x->>'card_id')::uuid, l.price_czk, (x->>'price_czk')::int,
         coalesce(l.quantity + s.keep_qty, 0),
         greatest(0, coalesce(l.quantity + s.keep_qty, 0) - coalesce((x->>'total_after')::int - (x->>'total_before')::int, 0)),
         k.why
    from public.stock_events e
    cross join jsonb_array_elements(e.undo) x
    left join public.listings l on l.id = (x->>'id')::uuid
    left join public.listing_stock s on s.listing_id = l.id
    left join public.stock_undo_skips(p_event) k on k.l = (x->>'id')::uuid
   where e.id = p_event and e.undo is not null and public.stock_perm(e.owner_id, 'view')
$$;

-- K prověření
create table if not exists public.stock_watch (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  rules jsonb not null default '{}'::jsonb,
  hours jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.stock_watch enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'stock_watch' and policyname = 'tým čte hlídání') then
    create policy "tým čte hlídání" on public.stock_watch for select using (public.stock_perm(owner_id, 'view'));
  end if;
end $$;

create table if not exists public.stock_flags (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  event_id bigint unique references public.stock_events(id) on delete cascade,
  rule text not null,
  title text not null,
  tag text,
  detail text,
  impact_czk integer,
  actor_id uuid,
  card_id uuid,
  at timestamptz not null,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text check (resolution in ('ok', 'undone', 'auto')),
  note text,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists stock_flags_owner_idx on public.stock_flags (owner_id, at desc);
alter table public.stock_flags enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'stock_flags' and policyname = 'tým čte k prověření') then
    create policy "tým čte k prověření" on public.stock_flags for select using (public.stock_perm(owner_id, 'view'));
  end if;
end $$;

-- Vedoucí obchodu (nebo majitel) smí měnit pravidla a vyřizovat nálezy.
create or replace function public.stock_lead(p_owner uuid) returns boolean
  language sql stable security definer set search_path to ''
as $$
  select (select auth.uid()) = p_owner or exists (
    select 1 from public.shop_staff s where s.owner_id = p_owner and s.user_id = (select auth.uid()) and s.role = 'ved')
$$;

create or replace function public.stock_watch_rules(p_owner uuid) returns jsonb
  language sql stable security definer set search_path to ''
as $$
  select '{"below_market":{"on":true,"pct":20},"big_drop":{"on":true,"pct":30},"loss":{"on":true,"qty":2,"czk":500},
           "inv_diff":{"on":false,"czk":1000},"off_hours":{"on":true},"sync_fail":{"on":true,"n":3},
           "notify_lead":true,"notify_actor":false}'::jsonb
         || coalesce((select w.rules from public.stock_watch w where w.owner_id = p_owner), '{}'::jsonb)
$$;

create or replace function public.stock_watch_save(p_owner uuid, p_rules jsonb, p_hours jsonb default null)
  returns void language plpgsql security definer set search_path to ''
as $$
begin
  if not public.stock_lead(p_owner) then raise exception 'Pravidla mění jen vedoucí' using errcode = '42501'; end if;
  insert into public.stock_watch (owner_id, rules, hours, updated_by)
  values (p_owner, coalesce(p_rules, '{}'::jsonb), p_hours, (select auth.uid()))
  on conflict (owner_id) do update set rules = excluded.rules, hours = coalesce(excluded.hours, public.stock_watch.hours),
    updated_at = now(), updated_by = excluded.updated_by;
  -- Změněná pravidla platí i pro změny, které se ještě neprověřily.
end;
$$;

create or replace function public.card_market_price(p_card uuid) returns integer
  language sql stable security definer set search_path to ''
as $$
  select coalesce(
    (select h.avg_price_czk from public.price_history h where h.card_id = p_card and h.avg_price_czk > 0 order by h.day desc limit 1),
    (select m.min_price from public.card_market m where m.card_id = p_card and m.min_price > 0))
$$;

-- Projde neprověřené změny obchodu (posledních 30 dní) a zapíše, co je neobvyklé. Vrací počet nových nálezů.
-- p_hours: otevírací doba [{"d":[1..7],"f":"10:00","t":"18:00"}] (isodow), jinak uložená.
create or replace function public.stock_flags_check(p_owner uuid, p_hours jsonb default null) returns integer
  language plpgsql security definer set search_path to ''
as $$
declare
  r jsonb; h jsonb; ev record; it jsonb; n int := 0; k int; m int; lq int; lv int;
  v_rule text; v_title text; v_tag text; v_detail text; v_card uuid; v_imp int; lt timestamp; cname text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' and not public.stock_perm(p_owner, 'view') then return 0; end if;
  if not exists (select 1 from public.profiles p where p.id = p_owner and p.kind = 'shop') then return 0; end if;
  r := public.stock_watch_rules(p_owner);
  h := coalesce(p_hours, (select w.hours from public.stock_watch w where w.owner_id = p_owner));
  if p_hours is not null then
    update public.stock_watch set hours = p_hours where owner_id = p_owner and hours is distinct from p_hours;
  end if;

  for ev in
    select e.* from public.stock_events e
     where e.owner_id = p_owner and not e.flag_checked and e.created_at > now() - interval '30 days'
       and e.actor_id is not null and e.reverts_id is null and e.undone_at is null and e.items is not null
     order by e.id
     for update skip locked
  loop
    v_rule := null; v_tag := null; v_detail := null; v_card := null; v_imp := ev.impact_czk; v_title := ev.title;
    k := jsonb_array_length(ev.items);
    it := ev.items->0;
    select c.name into cname from public.cards c where c.id = (it->>'c')::uuid;

    if ev.kind = 'price' and k = 1 and coalesce((r->'below_market'->>'on')::boolean, false)
       and it->>'p1' is not null and it->>'p0' is not null and (it->>'p1')::int < (it->>'p0')::int then
      m := public.card_market_price((it->>'c')::uuid);
      if m > 0 and (it->>'p1')::int < m * (1 - (r->'below_market'->>'pct')::numeric / 100) then
        v_rule := 'below_market'; v_title := 'Cena hluboko pod trhem';
        v_tag := '−' || round((1 - (it->>'p1')::numeric / m) * 100) || ' %';
        v_detail := coalesce(cname, 'Karta') || ' ' || (it->>'p0') || ' Kč → ' || (it->>'p1') || ' Kč · trh ' || m || ' Kč';
        v_card := (it->>'c')::uuid;
      end if;
    end if;

    if v_rule is null and ev.kind = 'price' and coalesce((r->'big_drop'->>'on')::boolean, false) then
      select count(*) into m from jsonb_array_elements(ev.items) x
       where x->>'p0' is not null and x->>'p1' is not null
         and (x->>'p1')::int < (x->>'p0')::int * (1 - (r->'big_drop'->>'pct')::numeric / 100);
      if m >= 5 then
        v_rule := 'big_drop'; v_tag := 'Hromadně';
        v_title := 'Zlevnění ' || m || ' karet naráz o víc než ' || (r->'big_drop'->>'pct') || ' %';
        v_detail := ev.title;
      end if;
    end if;

    if v_rule is null and ev.kind = 'stock' and ev.title like 'Inventura %' and coalesce((r->'inv_diff'->>'on')::boolean, false) then
      select coalesce(sum(greatest((x->>'q0')::int - (x->>'q1')::int, 0) * coalesce((x->>'p0')::int, (x->>'p1')::int, 0)), 0)
        into lv from jsonb_array_elements(ev.items) x;
      if lv > (r->'inv_diff'->>'czk')::int then
        v_rule := 'inv_diff'; v_title := 'Velký rozdíl v inventuře'; v_detail := ev.title; v_imp := -lv;
      end if;
    elsif v_rule is null and ev.kind = 'stock' and coalesce((r->'loss'->>'on')::boolean, false) then
      select coalesce(sum(greatest((x->>'q0')::int - (x->>'q1')::int, 0)), 0),
             coalesce(sum(greatest((x->>'q0')::int - (x->>'q1')::int, 0) * coalesce((x->>'p0')::int, (x->>'p1')::int, 0)), 0)
        into lq, lv from jsonb_array_elements(ev.items) x;
      if lq > 0 and (lq > (r->'loss'->>'qty')::int or lv > (r->'loss'->>'czk')::int) then
        v_rule := 'loss'; v_imp := -lv;
        v_title := case when lq = 1 then 'Ubyl 1 ks' when lq < 5 then 'Ubyly ' || lq || ' ks' else 'Ubylo ' || lq || ' ks' end || ' bez prodeje';
        v_detail := case when k = 1 then coalesce(cname, 'Karta') else k || ' karet' end
                    || coalesce(' · ' || nullif(it->>'loc0', ''), '') || ' · ručně odebráno';
        if k = 1 then v_card := (it->>'c')::uuid; end if;
      end if;
    end if;

    if ev.actor_id <> p_owner and coalesce((r->'off_hours'->>'on')::boolean, false)
       and h is not null and jsonb_typeof(h) = 'array' and jsonb_array_length(h) > 0 then
      lt := ev.created_at at time zone 'Europe/Prague';
      if not exists (
        select 1 from jsonb_array_elements(h) d
         where extract(isodow from lt)::int in (select jsonb_array_elements_text(d->'d')::int)
           and lt::time >= (d->>'f')::time and lt::time < (d->>'t')::time) then
        if v_rule is null then
          v_rule := 'off_hours'; v_tag := 'Mimo otevírací dobu';
          v_detail := coalesce(ev.detail, case when k = 1 then cname end);
          if k = 1 then v_card := (it->>'c')::uuid; end if;
        else
          v_tag := coalesce(v_tag || ' · ', '') || 'Mimo otevírací dobu';
        end if;
      end if;
    end if;

    if v_rule is not null then
      insert into public.stock_flags (owner_id, event_id, rule, title, tag, detail, impact_czk, actor_id, card_id, at)
      values (p_owner, ev.id, v_rule, left(v_title, 200), v_tag, left(v_detail, 300), v_imp, ev.actor_id, v_card, ev.created_at)
      on conflict (event_id) do nothing;
      if found then n := n + 1; end if;
    end if;
    update public.stock_events set flag_checked = true where id = ev.id;
  end loop;

  update public.stock_events set flag_checked = true where owner_id = p_owner and not flag_checked
     and (actor_id is null or reverts_id is not null or undone_at is not null or items is null or created_at <= now() - interval '30 days');
  return n;
end;
$$;

create or replace function public.stock_flag_resolve(p_id bigint, p_note text default null) returns integer
  language plpgsql security definer set search_path to ''
as $$
declare own uuid;
begin
  select f.owner_id into own from public.stock_flags f where f.id = p_id and f.resolved_at is null;
  if own is null then return 0; end if;
  if not public.stock_lead(own) then raise exception 'Vyřizovat to může jen vedoucí' using errcode = '42501'; end if;
  update public.stock_flags set resolved_at = now(), resolved_by = (select auth.uid()), resolution = 'ok',
         note = nullif(left(trim(coalesce(p_note, '')), 200), '')
   where id = p_id;
  return 1;
end;
$$;

-- Vrácení: nový řádek „Vráceno: …“, který jde znovu vrátit; hromadné nechá být prodané a jinak změněné karty.
create or replace function public.stock_undo(p_event bigint) returns integer
  language plpgsql security definer set search_path to ''
as $$
declare
  uid uuid := (select auth.uid());
  e public.stock_events;
  u jsonb;
  oldq jsonb;
  snap jsonb;
  n int;
  skip uuid[] := '{}';
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření' using errcode = '42501'; end if;
  select * into e from public.stock_events x where x.id = p_event and x.undone_at is null and x.undo is not null for update;
  if e.id is null or not public.stock_perm(e.owner_id, 'price') then return 0; end if;
  skip := array(select s.l from public.stock_undo_skips(p_event) s);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into u from jsonb_array_elements(e.undo) x where not ((x->>'id')::uuid = any(skip));

  select jsonb_agg(jsonb_build_object('id', l.id, 'card_id', l.card_id, 'price_czk', l.price_czk, 'negotiable', l.negotiable,
           'quantity', l.quantity, 'keep_qty', s.keep_qty, 'trade_qty', s.trade_qty, 'location', s.location))
    into snap
    from public.listings l join public.listing_stock s on s.listing_id = l.id
   where l.id in (select (x->>'id')::uuid from jsonb_array_elements(u) x)
     and l.seller_id = e.owner_id and l.removed_at is null and l.hidden_qty is null;
  select jsonb_object_agg(l.id, l.quantity) into oldq from public.listings l
   where l.id in (select (x->>'id')::uuid from jsonb_array_elements(u) x);

  with b as (
    select (x->>'id')::uuid id, (x->>'price_czk')::int price_czk, (x->>'negotiable')::boolean negotiable,
           (x->>'quantity')::int quantity, (x->>'trade_qty')::int trade_qty, x->>'location' location,
           (x->>'total_before')::int tb, (x->>'total_after')::int ta
      from jsonb_array_elements(u) x
  ), cur as (
    select b.*, greatest(0, l.quantity + s.keep_qty - coalesce(b.ta - b.tb, 0)) total
      from b join public.listings l on l.id = b.id and l.seller_id = e.owner_id and l.removed_at is null and l.hidden_qty is null
      join public.listing_stock s on s.listing_id = l.id
  ), upd as (
    update public.listings l
       set price_czk = cur.price_czk, negotiable = cur.negotiable, quantity = least(cur.quantity, cur.total)
      from cur where l.id = cur.id
    returning l.id, l.quantity, cur.total, cur.trade_qty, cur.location
  )
  update public.listing_stock s
     set keep_qty = upd.total - upd.quantity, trade_qty = least(upd.trade_qty, upd.total), location = upd.location, updated_at = now()
    from upd where s.listing_id = upd.id;
  get diagnostics n = row_count;

  if exists (select 1 from public.listings l where l.seller_id = e.owner_id and oldq ? l.id::text and l.quantity > (oldq->>l.id::text)::int)
     and not coalesce(public.seller_ready(e.owner_id), false) then
    raise exception 'Prodávat jde až s dopravou a platbou' using errcode = '42501';
  end if;

  if snap is not null then
    insert into public.stock_events (owner_id, actor_id, kind, title, detail, reverts_id, undo, flag_checked)
    select e.owner_id, uid, e.kind,
           left(case when e.reverts_id is null then 'Vráceno: ' || e.title else regexp_replace(e.title, '^Vráceno: ', '') end, 200),
           e.detail, p_event,
           (select jsonb_agg(b || jsonb_build_object('total_before', (b->>'quantity')::int + (b->>'keep_qty')::int,
                                                     'total_after', l.quantity + s.keep_qty))
              from jsonb_array_elements(snap) b
              join public.listings l on l.id = (b->>'id')::uuid join public.listing_stock s on s.listing_id = l.id),
           true;
  end if;

  update public.stock_events set undone_at = now(), undone_by = uid where id = p_event;
  update public.stock_flags set resolved_at = now(), resolved_by = uid, resolution = 'undone'
   where event_id = p_event and resolved_at is null;
  return n;
end;
$$;
-- Bez revoke: funkce samy kontrolují práva (stock_perm / stock_lead, anonym nic nedostane).
