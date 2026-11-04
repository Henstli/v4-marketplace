-- Sklad, fáze 3: tým obchodu (zaměstnanci, role a práva), inventury, plán a směny.
-- Vedoucí = majitel obchodu (může vše) nebo zaměstnanec s rolí Vedoucí. Prodavač a Skladník mají práva podle matice obchodu.

create table public.shop_staff (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('ved', 'pro', 'skl')),
  created_at timestamptz not null default now(),
  primary key (owner_id, user_id),
  check (owner_id <> user_id)
);
create index shop_staff_user_idx on public.shop_staff (user_id);
alter table public.shop_staff enable row level security;
grant select, update (role), delete on public.shop_staff to authenticated;

-- Matice práv rolí (Prodavač, Skladník). Bez řádku platí výchozí práva.
create table public.shop_roles (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('pro', 'skl')),
  perms text[] not null default '{}',
  primary key (owner_id, role),
  check (perms <@ array['view', 'add', 'price', 'ord', 'inv', 'plan', 'diff', 'conn', 'staff'])
);
alter table public.shop_roles enable row level security;
grant select, insert, update (perms) on public.shop_roles to authenticated;

-- Nastavení týmu: kdo zapisuje směny, hranice rozdílu ke schválení.
create table public.shop_team (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  shift_mode text not null default 'lead' check (shift_mode in ('lead', 'self')),
  diff_limit int not null default 0 check (diff_limit between 0 and 100000),
  updated_at timestamptz not null default now()
);
alter table public.shop_team enable row level security;
grant select, insert, update (shift_mode, diff_limit, updated_at) on public.shop_team to authenticated;

-- Smí přihlášený u obchodu p_owner dělat p_perm? Majitel a Vedoucí vždy.
create or replace function public.stock_perm(p_owner uuid, p_perm text)
  returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) = p_owner or exists (
    select 1 from public.shop_staff s
      left join public.shop_roles r on r.owner_id = s.owner_id and r.role = s.role
     where s.owner_id = p_owner and s.user_id = (select auth.uid())
       and (s.role = 'ved' or p_perm = any(coalesce(r.perms,
             case s.role when 'pro' then array['view', 'add', 'price', 'ord', 'inv'] else array['inv'] end))))
$$;
revoke execute on function public.stock_perm(uuid, text) from public, anon;
grant execute on function public.stock_perm(uuid, text) to authenticated;

create policy "tým obchodu" on public.shop_staff for select to authenticated
  using (user_id = (select auth.uid()) or public.stock_perm(owner_id, 'view'));
create policy "správa týmu" on public.shop_staff for update to authenticated
  using (public.stock_perm(owner_id, 'staff')) with check (public.stock_perm(owner_id, 'staff'));
create policy "odebrat z týmu" on public.shop_staff for delete to authenticated
  using (public.stock_perm(owner_id, 'staff') or user_id = (select auth.uid()));
create policy "role obchodu" on public.shop_roles for select to authenticated using (public.stock_perm(owner_id, 'view'));
create policy "nastavit role" on public.shop_roles for insert to authenticated with check (public.stock_perm(owner_id, 'staff'));
create policy "upravit role" on public.shop_roles for update to authenticated
  using (public.stock_perm(owner_id, 'staff')) with check (public.stock_perm(owner_id, 'staff'));
create policy "nastavení týmu" on public.shop_team for select to authenticated using (public.stock_perm(owner_id, 'view') or public.stock_perm(owner_id, 'inv'));
create policy "nastavit tým" on public.shop_team for insert to authenticated with check (public.stock_perm(owner_id, 'staff'));
create policy "upravit tým" on public.shop_team for update to authenticated
  using (public.stock_perm(owner_id, 'staff')) with check (public.stock_perm(owner_id, 'staff'));

-- Přidat člověka do týmu podle e-mailu jeho účtu V4cards.
create or replace function public.staff_add(p_owner uuid, p_email text, p_role text)
  returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if not public.stock_perm(p_owner, 'staff') then raise exception 'Tým může spravovat jen vedoucí' using errcode = '42501'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření' using errcode = '42501'; end if;
  if p_role not in ('ved', 'pro', 'skl') then raise exception 'Neznámá role'; end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if uid is null then return 'no_account'; end if;
  if uid = p_owner then return 'owner'; end if;
  insert into public.shop_staff (owner_id, user_id, role) values (p_owner, uid, p_role)
    on conflict (owner_id, user_id) do update set role = excluded.role;
  return 'ok';
end;
$$;
revoke execute on function public.staff_add(uuid, text, text) from public, anon;
grant execute on function public.staff_add(uuid, text, text) to authenticated;

-- Tým čte sklad a historii obchodu (právo Prohlížet) a objednávky (právo K odeslání).
create policy "tým čte sklad" on public.listing_stock for select to authenticated using (public.stock_perm(seller_id, 'view'));
create policy "tým čte historii" on public.stock_events for select to authenticated using (public.stock_perm(owner_id, 'view'));
create policy "tým vidí objednávky k odeslání" on public.orders for select to authenticated
  using (status in ('confirmed', 'pending_payment', 'paid', 'shipped', 'delivered') and public.stock_perm(seller_id, 'ord'));
create policy "tým vidí položky" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id and public.stock_perm(o.seller_id, 'ord')));
create policy "tým vidí doručení" on public.order_delivery for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_delivery.order_id
    and o.status in ('confirmed', 'pending_payment', 'paid', 'shipped', 'delivered') and public.stock_perm(o.seller_id, 'ord')));

-- Odeslání a předání smí i tým s právem K odeslání (ostatní změny stavu dál jen prodejce a kupující).
create or replace function public.set_order_status(target uuid, next_status public.order_status)
  returns void language plpgsql security definer set search_path = '' as $function$
declare
  o public.orders;
  me uuid := auth.uid();
  pay text;
  crew boolean;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found then raise exception 'Objednávka neexistuje'; end if;
  pay := coalesce(o.payment, 'transfer');
  crew := o.seller_id = me or public.stock_perm(o.seller_id, 'ord');

  if o.seller_id = me and o.status = 'requested' and next_status in ('confirmed', 'declined') then
    if o.expires_at < now() then raise exception 'Na objednávku už vypršel čas'; end if;
    update public.orders set status = next_status, decided_at = now() where id = target;
    if next_status = 'declined' then perform public.release_order_items(target); end if;
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'paid' and pay = 'transfer' and o.buyer_paid_at is not null then
    update public.orders set status = 'paid', cancel_request_at = null where id = target;
  elsif crew and o.delivery = 'ship' and next_status = 'shipped'
      and ((o.status = 'paid' and pay = 'transfer') or (o.status = 'confirmed' and pay = 'cod')) then
    update public.orders set status = 'shipped' where id = target;
  elsif crew and o.status = 'confirmed' and next_status = 'delivered' and o.delivery = 'pickup' and pay = 'cash' then
    update public.orders set status = 'delivered', delivered_at = now() where id = target;
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'cancelled' then
    if o.buyer_paid_at is not null and now() < public.order_cancel_from(o) then
      raise exception 'Zrušit půjde až po čekací době, nebo se souhlasem kupujícího';
    end if;
    update public.orders set status = 'cancelled', cancel_request_at = null where id = target;
    perform public.release_order_items(target);
  elsif o.buyer_id = me and next_status = 'cancelled'
      and (o.status = 'requested' or (o.status = 'confirmed' and o.buyer_paid_at is null)) then
    update public.orders set status = 'cancelled', cancel_request_at = null where id = target;
    perform public.release_order_items(target);
  elsif o.buyer_id = me and next_status = 'delivered'
      and (o.status = 'shipped' or (o.status = 'paid' and o.delivery = 'pickup')) then
    update public.orders set status = 'delivered', delivered_at = now() where id = target;
  else
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
end;
$function$;

create or replace function public.set_order_tracking(target uuid, p_tracking text)
  returns void language plpgsql security definer set search_path = '' as $function$
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  update public.orders set tracking = nullif(left(trim(p_tracking), 60), '')
  where id = target and (seller_id = auth.uid() or public.stock_perm(seller_id, 'ord'))
    and status in ('paid', 'shipped', 'confirmed', 'delivered');
  if not found then raise exception 'Objednávka neexistuje'; end if;
end;
$function$;

-- Změny skladu běží s právy funkce: řádky musí patřit jednomu obchodu a přihlášený musí mít právo.
-- Ceny a prodej = právo Měnit ceny, ostatní = Přidávat karty. Prodávat jde jen s dopravou a platbou obchodu.
create or replace function public.stock_change(p_ids uuid[], p_op text, p_title text,
    p_num numeric default null, p_text text default null, p_set jsonb default null)
  returns int language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  own uuid;
  ids uuid[];
  before jsonb;
  n int := 0;
  k text := 'stock';
begin
  if uid is null then raise exception 'Nejdřív se přihlaste' using errcode = '42501'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření' using errcode = '42501'; end if;
  if p_op not in ('pct', 'price', 'negotiable', 'sell', 'unsell', 'trade_all', 'trade_none', 'location', 'set', 'remove') then
    raise exception 'Neznámá změna';
  end if;
  select l.seller_id into own from public.listings l where l.id = p_ids[1];
  if own is null then return 0; end if;
  if not public.stock_perm(own, case when p_op in ('pct', 'price', 'negotiable', 'sell', 'unsell', 'set') then 'price' else 'add' end) then
    raise exception 'Na tuto změnu nemáte právo' using errcode = '42501';
  end if;
  ids := array(select l.id from public.listings l
    where l.id = any(p_ids) and l.seller_id = own and l.removed_at is null and l.hidden_qty is null);
  if p_op = 'set' and coalesce(array_length(ids, 1), 0) <> 1 then raise exception 'Upravit jde jen jeden řádek'; end if;
  if coalesce(array_length(ids, 1), 0) = 0 then return 0; end if;
  if p_op in ('pct', 'price', 'negotiable') then k := 'price'; end if;
  if p_op = 'pct' and (p_num is null or p_num <= -100 or p_num > 1000 or p_num = 0) then raise exception 'Změna ceny musí být mezi -99 a 1000 %%'; end if;
  if p_op = 'price' and (p_num is null or p_num <= 0 or p_num <> trunc(p_num)) then raise exception 'Cena musí být celé kladné číslo'; end if;

  select jsonb_agg(jsonb_build_object('id', l.id, 'card_id', l.card_id, 'price_czk', l.price_czk, 'negotiable', l.negotiable, 'quantity', l.quantity,
      'keep_qty', s.keep_qty, 'trade_qty', s.trade_qty, 'location', s.location))
    into before
    from public.listings l join public.listing_stock s on s.listing_id = l.id
   where l.id = any(ids);

  if p_op = 'pct' then
    update public.listings set price_czk = greatest(1, round(price_czk * (1 + p_num / 100.0))::int)
     where id = any(ids) and price_czk is not null;
  elsif p_op = 'price' then
    update public.listings set price_czk = p_num::int, negotiable = false where id = any(ids);
  elsif p_op = 'negotiable' then
    update public.listings set price_czk = null, negotiable = true where id = any(ids);
  elsif p_op = 'sell' then
    update public.listings l set quantity = l.quantity + s.keep_qty
      from public.listing_stock s where s.listing_id = l.id and l.id = any(ids) and s.keep_qty > 0;
    update public.listing_stock set keep_qty = 0, updated_at = now(), listed_at = coalesce(listed_at, now())
     where listing_id = any(ids) and keep_qty > 0;
  elsif p_op = 'unsell' then
    update public.listing_stock s set keep_qty = s.keep_qty + l.quantity, updated_at = now()
      from public.listings l where s.listing_id = l.id and l.id = any(ids) and l.quantity > 0;
    update public.listings set quantity = 0 where id = any(ids) and quantity > 0;
  elsif p_op = 'trade_all' then
    update public.listing_stock s set trade_qty = l.quantity + s.keep_qty, updated_at = now()
      from public.listings l where s.listing_id = l.id and l.id = any(ids);
  elsif p_op = 'trade_none' then
    update public.listing_stock set trade_qty = 0, updated_at = now() where listing_id = any(ids);
  elsif p_op = 'location' then
    update public.listing_stock set location = nullif(left(trim(coalesce(p_text, '')), 60), ''), updated_at = now()
     where listing_id = any(ids);
  elsif p_op = 'set' then
    if p_set ? 'price_czk' then
      if jsonb_typeof(p_set->'price_czk') = 'null' then
        update public.listings set price_czk = null, negotiable = true where id = ids[1];
      else
        if (p_set->>'price_czk')::int <= 0 then raise exception 'Cena musí být celé kladné číslo'; end if;
        update public.listings set price_czk = (p_set->>'price_czk')::int, negotiable = false where id = ids[1];
      end if;
    end if;
    if p_set ? 'quantity' then
      if (p_set->>'quantity')::int < 0 then raise exception 'Počet kusů nesmí být záporný'; end if;
      update public.listings set quantity = (p_set->>'quantity')::int where id = ids[1];
    end if;
    update public.listing_stock set
        keep_qty = coalesce((p_set->>'keep_qty')::int, keep_qty),
        trade_qty = coalesce((p_set->>'trade_qty')::int, trade_qty),
        location = case when p_set ? 'location' then nullif(left(trim(coalesce(p_set->>'location', '')), 60), '') else location end,
        buy_price_czk = case when p_set ? 'buy_price_czk' then (p_set->>'buy_price_czk')::int else buy_price_czk end,
        updated_at = now()
     where listing_id = ids[1];
    update public.listing_stock s set listed_at = coalesce(s.listed_at, now())
      from public.listings l where s.listing_id = l.id and l.id = ids[1] and l.quantity > 0;
  elsif p_op = 'remove' then
    -- Řádek bez objednávek zmizí, s objednávkou zůstane prázdný (objednávka na něj odkazuje).
    delete from public.listings l where l.id = any(ids)
      and not exists (select 1 from public.order_items oi where oi.listing_id = l.id);
    update public.listings set quantity = 0 where id = any(ids) and quantity > 0;
    update public.listing_stock set keep_qty = 0, trade_qty = 0, updated_at = now() where listing_id = any(ids);
  end if;

  -- Víc kusů na prodej jde jen s dopravou a platbou obchodu.
  if exists (select 1 from jsonb_array_elements(before) b join public.listings l on l.id = (b->>'id')::uuid
              where l.quantity > (b->>'quantity')::int)
     and not coalesce(public.seller_ready(own), false) then
    raise exception 'Prodávat jde až s dopravou a platbou' using errcode = '42501';
  end if;

  -- Výměna nesmí být víc než kusů celkem (výměna se smí překrývat s prodejem).
  update public.listing_stock s set trade_qty = l.quantity + s.keep_qty
    from public.listings l where s.listing_id = l.id and l.id = any(ids) and s.trade_qty > l.quantity + s.keep_qty;

  n := coalesce(array_length(ids, 1), 0);
  insert into public.stock_events (owner_id, actor_id, kind, title, undo, sample)
  select own, uid, k, left(coalesce(nullif(trim(p_title), ''), 'Úprava skladu'), 200),
    case when p_op = 'remove' then null else
      (select jsonb_agg(b || jsonb_build_object('total_before', (b->>'quantity')::int + (b->>'keep_qty')::int,
                                                'total_after', coalesce(l.quantity + s.keep_qty, 0)))
         from jsonb_array_elements(before) b
         left join public.listings l on l.id = (b->>'id')::uuid
         left join public.listing_stock s on s.listing_id = l.id) end,
    (select jsonb_agg(x) from (
       select jsonb_build_array(c.name,
                public.stock_row_text((b->>'price_czk')::int, (b->>'quantity')::int, (b->>'keep_qty')::int),
                case when l.id is null then 'odebráno' else public.stock_row_text(l.price_czk, l.quantity, s.keep_qty) end) x
         from jsonb_array_elements(before) b
         left join public.listings l on l.id = (b->>'id')::uuid
         left join public.listing_stock s on s.listing_id = l.id
         left join public.cards c on c.id = (b->>'card_id')::uuid
         limit 20) t);
  return n;
end;
$$;

create or replace function public.stock_undo(p_event bigint)
  returns int language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  own uuid;
  u jsonb;
  oldq jsonb;
  n int;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření' using errcode = '42501'; end if;
  select e.undo, e.owner_id into u, own from public.stock_events e
   where e.id = p_event and e.undone_at is null and e.undo is not null
   for update;
  if u is null or not public.stock_perm(own, 'price') then return 0; end if;
  select jsonb_object_agg(l.id, l.quantity) into oldq from public.listings l
   where l.id in (select (x->>'id')::uuid from jsonb_array_elements(u) x);

  with b as (
    select (x->>'id')::uuid id, (x->>'price_czk')::int price_czk, (x->>'negotiable')::boolean negotiable,
           (x->>'quantity')::int quantity, (x->>'trade_qty')::int trade_qty, x->>'location' location,
           (x->>'total_before')::int tb, (x->>'total_after')::int ta
      from jsonb_array_elements(u) x
  ), cur as (
    select b.*, greatest(0, l.quantity + s.keep_qty - (b.ta - b.tb)) total
      from b join public.listings l on l.id = b.id and l.seller_id = own and l.removed_at is null and l.hidden_qty is null
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

  if exists (select 1 from public.listings l where l.seller_id = own and oldq ? l.id::text and l.quantity > (oldq->>l.id::text)::int)
     and not coalesce(public.seller_ready(own), false) then
    raise exception 'Prodávat jde až s dopravou a platbou' using errcode = '42501';
  end if;

  update public.stock_events set undone_at = now() where id = p_event;
  return n;
end;
$$;

-- ===== Inventury =====

-- Místa skladu (umístění) s nastavením: skupina, jak často kontrolovat, kdy naposledy.
create table public.stock_places (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  group_name text check (char_length(group_name) <= 40),
  every_days int not null default 30 check (every_days between 1 and 365),
  last_checked_at timestamptz,
  primary key (owner_id, name)
);
alter table public.stock_places enable row level security;
grant select on public.stock_places to authenticated;
create policy "místa obchodu" on public.stock_places for select to authenticated
  using (public.stock_perm(owner_id, 'view') or public.stock_perm(owner_id, 'inv'));

-- Skupiny míst: slepá inventura, kdo obvykle počítá.
create table public.stock_groups (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  blind boolean not null default false,
  person uuid references public.profiles(id) on delete set null,
  primary key (owner_id, name)
);
alter table public.stock_groups enable row level security;
grant select on public.stock_groups to authenticated;
create policy "skupiny míst" on public.stock_groups for select to authenticated
  using (public.stock_perm(owner_id, 'view') or public.stock_perm(owner_id, 'inv'));

-- Inventura jednoho místa: kdo počítal, kolik čeho podle skladu a kolik napočítal, stav a schválení.
create table public.inventories (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  place text not null,
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'counting' check (status in ('counting', 'review', 'done', 'cancelled')),
  blind boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  seconds int,
  -- [{listing_id, name, set, cond, lang, expected, counted}]
  lines jsonb not null default '[]'::jsonb,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  note text check (char_length(note) <= 300)
);
create index inventories_owner_idx on public.inventories (owner_id, started_at desc);
alter table public.inventories enable row level security;
grant select on public.inventories to authenticated;
-- Rozdíly a cizí inventury vidí jen kdo má právo Vidět rozdíly; ostatní jen svoje.
create policy "inventury" on public.inventories for select to authenticated
  using (user_id = (select auth.uid()) or public.stock_perm(owner_id, 'diff'));

-- Plán inventur: kdo kdy počítá která místa (jeden člověk max. 1 úkol na den).
create table public.inventory_plan (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  places text[] not null check (cardinality(places) between 1 and 50),
  primary key (owner_id, day, user_id)
);
alter table public.inventory_plan enable row level security;
grant select, insert, update (places), delete on public.inventory_plan to authenticated;
create policy "plán čte tým" on public.inventory_plan for select to authenticated
  using (public.stock_perm(owner_id, 'inv') or public.stock_perm(owner_id, 'plan'));
create policy "plán zapisuje vedoucí" on public.inventory_plan for insert to authenticated with check (public.stock_perm(owner_id, 'plan'));
create policy "plán upravuje vedoucí" on public.inventory_plan for update to authenticated
  using (public.stock_perm(owner_id, 'plan')) with check (public.stock_perm(owner_id, 'plan'));
create policy "plán maže vedoucí" on public.inventory_plan for delete to authenticated using (public.stock_perm(owner_id, 'plan'));

-- Směny: dny volna (kdy člověk nemůže). Zapisuje vedoucí, nebo každý sám (shop_team.shift_mode = self).
create table public.staff_shifts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  off boolean not null default true,
  primary key (owner_id, user_id, day)
);
alter table public.staff_shifts enable row level security;
grant select, insert, update (off), delete on public.staff_shifts to authenticated;
create policy "směny čte tým" on public.staff_shifts for select to authenticated
  using (public.stock_perm(owner_id, 'inv') or public.stock_perm(owner_id, 'plan'));
create policy "směny zapisuje vedoucí nebo každý sám" on public.staff_shifts for all to authenticated
  using (public.stock_perm(owner_id, 'plan') or (user_id = (select auth.uid())
    and exists (select 1 from public.shop_team t where t.owner_id = staff_shifts.owner_id and t.shift_mode = 'self')))
  with check (public.stock_perm(owner_id, 'plan') or (user_id = (select auth.uid())
    and exists (select 1 from public.shop_team t where t.owner_id = staff_shifts.owner_id and t.shift_mode = 'self')));

-- Uložit nastavení místa / skupiny (vedoucí s právem Plánovat).
create or replace function public.stock_place_save(p_owner uuid, p_name text, p_group text, p_every int)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.stock_perm(p_owner, 'plan') then raise exception 'Na tuto změnu nemáte právo' using errcode = '42501'; end if;
  insert into public.stock_places (owner_id, name, group_name, every_days)
  values (p_owner, left(trim(p_name), 60), nullif(left(trim(coalesce(p_group, '')), 40), ''), greatest(1, least(365, coalesce(p_every, 30))))
  on conflict (owner_id, name) do update set group_name = excluded.group_name, every_days = excluded.every_days;
  if nullif(trim(coalesce(p_group, '')), '') is not null then
    insert into public.stock_groups (owner_id, name) values (p_owner, left(trim(p_group), 40)) on conflict do nothing;
  end if;
end;
$$;
revoke execute on function public.stock_place_save(uuid, text, text, int) from public, anon;
grant execute on function public.stock_place_save(uuid, text, text, int) to authenticated;

create or replace function public.stock_group_save(p_owner uuid, p_name text, p_blind boolean, p_person uuid)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.stock_perm(p_owner, 'plan') then raise exception 'Na tuto změnu nemáte právo' using errcode = '42501'; end if;
  insert into public.stock_groups (owner_id, name, blind, person) values (p_owner, left(trim(p_name), 40), coalesce(p_blind, false), p_person)
  on conflict (owner_id, name) do update set blind = excluded.blind, person = excluded.person;
end;
$$;
revoke execute on function public.stock_group_save(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.stock_group_save(uuid, text, boolean, uuid) to authenticated;

-- Začít inventuru místa: uloží, co má podle skladu na místě být (karta + stav + jazyk).
create or replace function public.inventory_start(p_owner uuid, p_place text)
  returns bigint language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  id_ bigint;
  bl boolean;
begin
  if not public.stock_perm(p_owner, 'inv') then raise exception 'Na inventuru nemáte právo' using errcode = '42501'; end if;
  select i.id into id_ from public.inventories i
   where i.owner_id = p_owner and i.place = p_place and i.status = 'counting' and i.user_id = uid;
  if id_ is not null then return id_; end if;
  if exists (select 1 from public.inventories i where i.owner_id = p_owner and i.place = p_place and i.status = 'counting') then
    raise exception 'Místo právě počítá někdo jiný';
  end if;
  select coalesce(g.blind, false) into bl from public.stock_places p
    left join public.stock_groups g on g.owner_id = p.owner_id and g.name = p.group_name
   where p.owner_id = p_owner and p.name = p_place;
  insert into public.inventories (owner_id, place, user_id, blind, lines)
  select p_owner, p_place, uid, coalesce(bl, false), coalesce(jsonb_agg(jsonb_build_object(
      'listing_id', l.id, 'name', c.name, 'set', upper(coalesce(cs.code, '')) || ' ' || c.number, 'cond', l.condition, 'lang', l.language,
      'image', c.image_url, 'expected', l.quantity + s.keep_qty, 'counted', null) order by c.name), '[]'::jsonb)
    from public.listings l
    join public.listing_stock s on s.listing_id = l.id
    join public.cards c on c.id = l.card_id
    left join public.card_sets cs on cs.id = c.set_id
   where l.seller_id = p_owner and s.location = p_place and l.removed_at is null and l.hidden_qty is null
     and l.quantity + s.keep_qty > 0
  returning id into id_;
  return id_;
end;
$$;
revoke execute on function public.inventory_start(uuid, text) from public, anon;
grant execute on function public.inventory_start(uuid, text) to authenticated;

-- Úprava stavu skladu podle inventury: rozdíl (napočítáno − podle skladu) se přičte k dnešnímu stavu,
-- takže co se během inventury prodalo, zůstane odečtené. Přebytek jde mimo prodej, manko nejdřív z kusů mimo prodej.
create or replace function public.inventory_apply(p_id bigint)
  returns int language plpgsql security definer set search_path = '' as $$
declare
  inv public.inventories;
  n int := 0;
  r record;
  before jsonb;
begin
  select * into inv from public.inventories where id = p_id;
  select jsonb_agg(jsonb_build_object('id', l.id, 'card_id', l.card_id, 'price_czk', l.price_czk, 'negotiable', l.negotiable, 'quantity', l.quantity,
      'keep_qty', s.keep_qty, 'trade_qty', s.trade_qty, 'location', s.location))
    into before
    from public.listings l join public.listing_stock s on s.listing_id = l.id
   where l.id in (select (x->>'listing_id')::uuid from jsonb_array_elements(inv.lines) x
                   where x->>'counted' is not null and (x->>'counted')::int <> (x->>'expected')::int);
  for r in
    select (x->>'listing_id')::uuid lid, (x->>'counted')::int - (x->>'expected')::int d
      from jsonb_array_elements(inv.lines) x
     where x->>'counted' is not null and (x->>'counted')::int <> (x->>'expected')::int
  loop
    if r.d > 0 then
      update public.listing_stock set keep_qty = keep_qty + r.d, updated_at = now() where listing_id = r.lid;
    else
      update public.listing_stock s set keep_qty = greatest(0, s.keep_qty + r.d), updated_at = now() where s.listing_id = r.lid;
      update public.listings l set quantity = greatest(0, l.quantity - greatest(0, -r.d - coalesce((select (b->>'keep_qty')::int from jsonb_array_elements(before) b where (b->>'id')::uuid = r.lid), 0)))
       where l.id = r.lid;
    end if;
    n := n + 1;
  end loop;
  update public.listing_stock s set trade_qty = l.quantity + s.keep_qty
    from public.listings l where s.listing_id = l.id and s.trade_qty > l.quantity + s.keep_qty
     and l.id in (select (b->>'id')::uuid from jsonb_array_elements(coalesce(before, '[]'::jsonb)) b);
  insert into public.stock_places (owner_id, name, last_checked_at) values (inv.owner_id, inv.place, now())
    on conflict (owner_id, name) do update set last_checked_at = now();
  if n > 0 then
    insert into public.stock_events (owner_id, actor_id, kind, title, detail, undo, sample)
    select inv.owner_id, (select auth.uid()), 'stock', left('Inventura ' || inv.place || ' · ' || n || case when n = 1 then ' rozdíl' when n < 5 then ' rozdíly' else ' rozdílů' end, 200),
      'Inventura č. ' || inv.id,
      (select jsonb_agg(b || jsonb_build_object('total_before', (b->>'quantity')::int + (b->>'keep_qty')::int,
                                                'total_after', l.quantity + s.keep_qty))
         from jsonb_array_elements(before) b
         join public.listings l on l.id = (b->>'id')::uuid join public.listing_stock s on s.listing_id = l.id),
      (select jsonb_agg(x) from (
         select jsonb_build_array(c.name, ((b->>'quantity')::int + (b->>'keep_qty')::int) || ' ks', (l.quantity + s.keep_qty) || ' ks') x
           from jsonb_array_elements(before) b
           join public.listings l on l.id = (b->>'id')::uuid join public.listing_stock s on s.listing_id = l.id
           join public.cards c on c.id = l.card_id limit 20) t);
  end if;
  return n;
end;
$$;
revoke execute on function public.inventory_apply(bigint) from public, anon, authenticated;

-- Uložit napočítané kusy (průběžně), p_finish = dokončit. Bez rozdílu se hned uzavře;
-- s rozdílem ho zapíše ten, kdo smí vidět rozdíly (do hranice obchodu), jinak čeká na schválení vedoucím.
create or replace function public.inventory_save(p_id bigint, p_counts jsonb, p_finish boolean, p_note text default null)
  returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  inv public.inventories;
  diff int;
  lim int;
begin
  select * into inv from public.inventories where id = p_id for update;
  if inv.id is null or inv.user_id is distinct from uid or inv.status <> 'counting' then raise exception 'Inventura už neběží'; end if;
  update public.inventories i set lines = (
      select jsonb_agg(x || case when p_counts ? (x->>'listing_id') then jsonb_build_object('counted', greatest(0, least(100000, (p_counts->>(x->>'listing_id'))::int))) else '{}'::jsonb end)
        from jsonb_array_elements(i.lines) x),
      note = coalesce(nullif(left(trim(coalesce(p_note, '')), 300), ''), note)
   where i.id = p_id
  returning * into inv;
  if not p_finish then return 'saved'; end if;
  if exists (select 1 from jsonb_array_elements(inv.lines) x where x->>'counted' is null) then
    raise exception 'Napočítejte prosím všechny karty (i nulou)';
  end if;
  select coalesce(sum(abs((x->>'counted')::int - (x->>'expected')::int)), 0) into diff from jsonb_array_elements(inv.lines) x;
  select coalesce(t.diff_limit, 0) into lim from public.shop_team t where t.owner_id = inv.owner_id;
  update public.inventories set finished_at = now(), seconds = extract(epoch from now() - started_at)::int where id = p_id;
  if diff = 0 or (public.stock_perm(inv.owner_id, 'diff') and diff <= greatest(coalesce(lim, 0), case when uid = inv.owner_id then 100000 else 0 end)) then
    perform public.inventory_apply(p_id);
    update public.inventories set status = 'done', decided_by = case when diff = 0 then null else uid end, decided_at = now() where id = p_id;
    return case when diff = 0 then 'ok' else 'applied' end;
  end if;
  update public.inventories set status = 'review' where id = p_id;
  return 'review';
end;
$$;
revoke execute on function public.inventory_save(bigint, jsonb, boolean, text) from public, anon;
grant execute on function public.inventory_save(bigint, jsonb, boolean, text) to authenticated;

-- Vedoucí: schválit rozdíly (zapíší se do skladu), nebo poslat přepočítat (nová inventura místa).
create or replace function public.inventory_decide(p_id bigint, p_approve boolean)
  returns text language plpgsql security definer set search_path = '' as $$
declare
  inv public.inventories;
begin
  select * into inv from public.inventories where id = p_id for update;
  if inv.id is null or inv.status <> 'review' then raise exception 'Inventura nečeká na schválení'; end if;
  if not public.stock_perm(inv.owner_id, 'diff') then raise exception 'Schvalovat rozdíly smí jen vedoucí' using errcode = '42501'; end if;
  if p_approve then
    perform public.inventory_apply(p_id);
    update public.inventories set status = 'done', decided_by = (select auth.uid()), decided_at = now() where id = p_id;
    return 'applied';
  end if;
  update public.inventories set status = 'cancelled', decided_by = (select auth.uid()), decided_at = now(),
    note = left(coalesce(note || ' · ', '') || 'Poslat přepočítat', 300) where id = p_id;
  return 'recount';
end;
$$;
revoke execute on function public.inventory_decide(bigint, boolean) from public, anon;
grant execute on function public.inventory_decide(bigint, boolean) to authenticated;

-- Zrušit rozpočítanou inventuru (kdo počítá nebo vedoucí).
create or replace function public.inventory_cancel(p_id bigint)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.inventories set status = 'cancelled', finished_at = now()
   where id = p_id and status = 'counting' and (user_id = (select auth.uid()) or public.stock_perm(owner_id, 'diff'));
end;
$$;
revoke execute on function public.inventory_cancel(bigint) from public, anon;
grant execute on function public.inventory_cancel(bigint) to authenticated;

-- Přidat kartu do skladu obchodu (zaměstnanec s právem Přidávat karty). Mimo prodej, prodávat pak jde přes Na prodej.
create or replace function public.stock_add_for(p_owner uuid, p_card uuid, p_condition public.card_condition, p_language text,
    p_price int, p_keep int, p_note text default null)
  returns uuid language plpgsql security definer set search_path = '' as $$
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
  insert into public.stock_events (owner_id, actor_id, kind, title)
  select p_owner, (select auth.uid()), 'stock', left('Přidáno: ' || c.name || ' · ' || p_keep || ' ks', 200) from public.cards c where c.id = p_card;
  return lid;
end;
$$;
revoke execute on function public.stock_add_for(uuid, uuid, public.card_condition, text, int, int, text) from public, anon;
grant execute on function public.stock_add_for(uuid, uuid, public.card_condition, text, int, int, text) to authenticated;

-- Obchody, ve kterých je přihlášený v týmu (přepínač Sklad: můj / obchodu).
create or replace function public.my_shops()
  returns table (owner_id uuid, name text, role text) language sql stable security definer set search_path = '' as $$
  select s.owner_id, coalesce(p.display_name, 'Obchod'), s.role
    from public.shop_staff s join public.profiles p on p.id = s.owner_id
   where s.user_id = (select auth.uid())
   order by 2
$$;
revoke execute on function public.my_shops() from public, anon;
grant execute on function public.my_shops() to authenticated;

-- Lidé v týmu obchodu se jménem a e-mailem (e-mail jen pro vedoucí).
create or replace function public.shop_team_list(p_owner uuid)
  returns table (user_id uuid, name text, email text, role text, created_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  select s.user_id, coalesce(p.display_name, 'Bez jména'),
    case when public.stock_perm(p_owner, 'staff') then u.email::text end, s.role, s.created_at
    from public.shop_staff s
    join public.profiles p on p.id = s.user_id
    left join auth.users u on u.id = s.user_id
   where s.owner_id = p_owner and (public.stock_perm(p_owner, 'view') or public.stock_perm(p_owner, 'inv'))
   order by s.created_at
$$;
revoke execute on function public.shop_team_list(uuid) from public, anon;
grant execute on function public.shop_team_list(uuid) to authenticated;

-- Upsert z aplikace (PostgREST) přepisuje i klíčové sloupce; RLS (with check) dál hlídá práva.
grant update (owner_id, role) on public.shop_roles to authenticated;
grant update (owner_id) on public.shop_team to authenticated;
grant update (owner_id, day, user_id) on public.inventory_plan to authenticated;
grant update (owner_id, user_id, day) on public.staff_shifts to authenticated;
