-- Doručení (DS DeliveryPayment, Šimon 27. 10. 2026): výdejní místo z mapy dopravce, nebo adresa.
-- V4cards jen ukáže mapu nebo formulář a údaje předá prodejci; zásilku podává a platí prodejce
-- pod svým účtem u dopravce. Ochrana údajů:
--   adresu a telefon vidí kupující vždy, prodejce až po potvrzení objednávky;
--   30 dní po uzavření objednávky se doručovací údaje smažou (u objednávky zůstane jen město);
--   uloženou adresu v účtu vidí a maže jen kupující.

-- Druh doručení podle dopravce: výdejní místo, adresa, nebo nic (vlastní způsob).
create or replace function public.carrier_kind(p_carrier text) returns text
  language sql immutable set search_path = '' as $$
  select case
    when p_carrier in ('zasilkovna', 'balikovna', 'ppl_point') then 'point'
    when p_carrier in ('zasilkovna_home', 'cp_doruky', 'ppl', 'dpd', 'gls', 'letter') then 'home'
    else null end;
$$;

alter table public.orders
  add column ship_city text check (char_length(ship_city) <= 80),
  add column closed_at timestamptz;

-- Kdy se objednávka uzavřela (převzato, zrušeno, odmítnuto, vypršelo).
create or replace function public.stamp_order_closed() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.status in ('delivered', 'cancelled', 'declined', 'expired') and new.closed_at is null then
    new.closed_at := now();
  end if;
  return new;
end;
$$;
create trigger stamp_order_closed before update of status on public.orders
  for each row execute function public.stamp_order_closed();
update public.orders set closed_at = coalesce(decided_at, created_at)
  where status in ('delivered', 'cancelled', 'declined', 'expired') and closed_at is null;

-- Doručovací údaje objednávky. Zapisuje jen place_order.
create table public.order_delivery (
  order_id uuid primary key references public.orders(id) on delete cascade,
  recipient text not null check (char_length(recipient) between 3 and 80),
  phone text check (phone ~ '^\+?[0-9]{9,15}$'),
  street text check (char_length(street) <= 120),
  city text check (char_length(city) <= 80),
  zip text check (zip ~ '^[0-9]{5}$'),
  country text check (country in ('CZ', 'SK')),
  point_id text check (char_length(point_id) <= 40),
  point_name text check (char_length(point_name) <= 120),
  point_address text check (char_length(point_address) <= 160),
  created_at timestamptz not null default now()
);
alter table public.order_delivery enable row level security;
grant select on public.order_delivery to authenticated;
create policy "doručení vidí kupující a prodejce po potvrzení" on public.order_delivery for select to authenticated
  using (exists (
    select 1 from public.orders o where o.id = order_id and (
      o.buyer_id = auth.uid()
      or (o.seller_id = auth.uid() and o.status in ('confirmed', 'pending_payment', 'paid', 'shipped', 'delivered'))
    )
  ));

-- Smazání doručovacích údajů 30 dní po uzavření objednávky (cron jednou denně).
create or replace function public.purge_order_delivery() returns void
  language sql security definer set search_path = '' as $$
  delete from public.order_delivery d
  using public.orders o
  where o.id = d.order_id and o.closed_at < now() - interval '30 days';
$$;
revoke execute on function public.purge_order_delivery() from public, anon, authenticated;
select cron.schedule('purge-order-delivery', '30 3 * * *', $$select public.purge_order_delivery()$$);

-- Uložená adresa kupujícího pro příští nákupy (jen když ji sám uloží).
create table public.buyer_addresses (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  recipient text not null check (char_length(recipient) between 3 and 80),
  phone text check (phone ~ '^\+?[0-9]{9,15}$'),
  street text check (char_length(street) <= 120),
  city text check (char_length(city) <= 80),
  zip text check (zip ~ '^[0-9]{5}$'),
  country text not null default 'CZ' check (country in ('CZ', 'SK')),
  updated_at timestamptz not null default now()
);
alter table public.buyer_addresses enable row level security;
grant select, insert, update, delete on public.buyer_addresses to authenticated;
create policy "adresu vidí majitel" on public.buyer_addresses for select to authenticated using (user_id = auth.uid());
create policy "adresu ukládá majitel" on public.buyer_addresses for insert to authenticated with check (user_id = auth.uid());
create policy "adresu mění majitel" on public.buyer_addresses for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "adresu maže majitel" on public.buyer_addresses for delete to authenticated using (user_id = auth.uid());

-- Objednávka s doručením:
-- choices = {"<seller_id>": {"delivery", "payment",
--   "point": {"id", "name", "address"},
--   "address": {"name", "phone", "street", "city", "zip", "country"}}}
create or replace function public.place_order(items jsonb, choices jsonb) returns setof uuid
  language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  item record;
  l public.listings;
  s record;
  c jsonb;
  p public.profiles;
  m public.seller_shipping_methods;
  v_delivery text;
  v_payment text;
  ship int;
  fee int;
  order_id uuid;
  open_count int;
  v_kind text;
  pt jsonb;
  ad jsonb;
  v_recipient text;
  v_phone text;
  v_street text;
  v_city text;
  v_zip text;
  v_country text;
  v_point_name text;
begin
  if buyer is null then raise exception 'Nejste přihlášeni'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'Košík je prázdný'; end if;
  if jsonb_typeof(choices) <> 'object' then raise exception 'Vyberte dopravu a platbu'; end if;

  create temp table _items (listing_id uuid, seller_id uuid, quantity int, price int) on commit drop;

  for item in select (e->>'listing_id')::uuid as listing_id, (e->>'quantity')::int as quantity from jsonb_array_elements(items) e loop
    select * into l from public.listings where id = item.listing_id for update;
    if not found then raise exception 'Nabídka už neexistuje'; end if;
    if l.seller_id = buyer then raise exception 'Nelze koupit vlastní nabídku'; end if;
    if l.price_czk is null then raise exception 'U nabídky s cenou dohodou pošlete prodejci návrh ceny'; end if;
    if item.quantity is null or item.quantity < 1 or item.quantity > l.quantity then
      raise exception 'Nabídka už nemá dost kusů';
    end if;
    update public.listings set quantity = quantity - item.quantity where id = l.id;
    insert into _items values (l.id, l.seller_id, item.quantity, l.price_czk);
  end loop;

  select count(*) into open_count from public.orders where buyer_id = buyer and status = 'requested';
  if open_count + (select count(distinct seller_id) from _items) > public.max_open_requests() then
    raise exception 'Máte moc nevyřízených objednávek. Počkejte, až je prodejci potvrdí, nebo některé zrušte.';
  end if;

  for s in select seller_id, sum(price * quantity)::int as subtotal from _items group by seller_id loop
    select * into p from public.profiles where id = s.seller_id;
    c := choices -> s.seller_id::text;
    v_delivery := c->>'delivery';
    v_payment := c->>'payment';
    if c is null or v_delivery is null or v_payment is null then raise exception 'Vyberte dopravu a platbu u každého prodejce'; end if;
    fee := 0;
    m := null;

    if v_delivery = 'pickup' then
      if not p.pickup then raise exception 'Prodejce % osobní předání nenabízí', p.display_name; end if;
      ship := 0;
    else
      select * into m from public.seller_shipping_methods where seller_id = s.seller_id and carrier = v_delivery;
      if not found then raise exception 'Prodejce % tuto dopravu nenabízí', p.display_name; end if;
      ship := case when p.free_shipping_from is not null and s.subtotal >= p.free_shipping_from then 0 else m.price_czk end;
    end if;

    if v_payment = 'transfer' then
      if not (p.pay_transfer and exists (select 1 from public.seller_payment a where a.user_id = s.seller_id)) then
        raise exception 'Prodejce % nepřijímá platbu převodem', p.display_name;
      end if;
    elsif v_payment = 'cod' then
      if m.carrier is null or not m.cod then raise exception 'Dobírka u této dopravy nejde'; end if;
      fee := m.cod_fee_czk;
    elsif v_payment = 'cash' then
      if v_delivery <> 'pickup' or not p.cash_on_pickup then raise exception 'Hotově jde platit jen při osobním předání'; end if;
    else
      raise exception 'Neznámý způsob platby';
    end if;

    -- Doručovací údaje: výdejní místo, nebo adresa (DS DeliveryPayment, Šimon 27. 10.).
    v_kind := public.carrier_kind(m.carrier);
    pt := case when jsonb_typeof(c->'point') = 'object' then c->'point' else null end;
    ad := case when jsonb_typeof(c->'address') = 'object' then c->'address' else '{}'::jsonb end;
    v_recipient := nullif(left(trim(ad->>'name'), 80), '');
    v_phone := nullif(regexp_replace(coalesce(ad->>'phone', ''), '[^0-9+]', '', 'g'), '');
    v_street := nullif(left(trim(ad->>'street'), 120), '');
    v_city := nullif(left(trim(ad->>'city'), 80), '');
    v_zip := nullif(regexp_replace(coalesce(ad->>'zip', ''), '\s', '', 'g'), '');
    v_country := coalesce(nullif(ad->>'country', ''), 'CZ');
    v_point_name := nullif(left(trim(coalesce(pt->>'name', case when jsonb_typeof(c->'point') = 'string' then c->>'point' end)), 120), '');

    if v_kind in ('point', 'home') then
      if v_recipient is null or char_length(v_recipient) < 3 then raise exception 'Vyplňte jméno příjemce'; end if;
      if v_phone is not null and v_phone !~ '^\+?[0-9]{9,15}$' then raise exception 'Telefon nevypadá správně'; end if;
      if v_phone is null and m.carrier <> 'letter' then raise exception 'Vyplňte telefon, dopravce na něj pošle zprávu o doručení'; end if;
    end if;
    if v_kind = 'point' and v_point_name is null then
      raise exception 'Vyberte výdejní místo u prodejce %', p.display_name;
    end if;
    if v_kind = 'home' then
      if v_street is null or v_city is null then raise exception 'Vyplňte ulici a město'; end if;
      if v_zip is null or v_zip !~ '^[0-9]{5}$' then raise exception 'PSČ má 5 číslic'; end if;
      if v_country not in ('CZ', 'SK') then raise exception 'Doručujeme jen do Česka a na Slovensko'; end if;
    end if;

    insert into public.orders (buyer_id, seller_id, status, total_czk, shipping_czk, cod_fee_czk, expires_at, delivery,
      payment, carrier, carrier_label, pickup_point, ship_city)
    values (buyer, s.seller_id, 'requested', s.subtotal + ship + fee, ship, fee,
      now() + make_interval(hours => public.request_hours()),
      case when v_delivery = 'pickup' then 'pickup' else 'ship' end,
      v_payment, m.carrier, m.label, case when v_kind = 'point' then v_point_name end,
      case when v_kind = 'home' then v_city end)
    returning id into order_id;

    if v_kind in ('point', 'home') then
      insert into public.order_delivery (order_id, recipient, phone, street, city, zip, country,
        point_id, point_name, point_address)
      values (order_id, v_recipient, v_phone,
        case when v_kind = 'home' then v_street end,
        case when v_kind = 'home' then v_city end,
        case when v_kind = 'home' then v_zip end,
        case when v_kind = 'home' then v_country end,
        case when v_kind = 'point' then nullif(left(trim(pt->>'id'), 40), '') end,
        case when v_kind = 'point' then v_point_name end,
        case when v_kind = 'point' then nullif(left(trim(pt->>'address'), 160), '') end);
    end if;
    insert into public.order_items (order_id, listing_id, quantity, price_czk)
    select order_id, listing_id, quantity, price from _items where seller_id = s.seller_id;
    return next order_id;
  end loop;
end;
$$;
revoke execute on function public.place_order(jsonb, jsonb) from public, anon;
grant execute on function public.place_order(jsonb, jsonb) to authenticated;
