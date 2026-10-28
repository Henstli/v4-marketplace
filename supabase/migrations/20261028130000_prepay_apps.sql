-- PayPal a Revolut jako další platba předem přímo prodejci (Šimon 28. 10., košík varianta A:
-- jedna volba „Předem“, kupující si způsob vybere až u potvrzené objednávky).
-- V4cards peníze nepřijímá: ukládáme jen jméno PayPal.Me a Revtag, odkaz skládá web
-- jen na paypal.me a revolut.me.

create table public.seller_payment_apps (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  paypal_me text check (paypal_me ~ '^[A-Za-z0-9]{1,20}$'),
  revtag text check (revtag ~ '^[a-z0-9._]{3,30}$'),
  updated_at timestamptz not null default now()
);
alter table public.seller_payment_apps enable row level security;
grant select, insert, update, delete on public.seller_payment_apps to authenticated;
create policy "vlastní platební aplikace" on public.seller_payment_apps for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "zápis po dvoufázovém ověření" on public.seller_payment_apps as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());

-- Platba předem jde, když má prodejce zapnutý převod s účtem, nebo vyplněný PayPal či Revolut.
create or replace function public.seller_prepay(p_seller uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select p.pay_transfer from public.profiles p where p.id = p_seller), false)
      and exists (select 1 from public.seller_payment a where a.user_id = p_seller)
    or exists (select 1 from public.seller_payment_apps x where x.user_id = p_seller
      and (x.paypal_me is not null or x.revtag is not null));
$$;
revoke execute on function public.seller_prepay(uuid) from public, anon;

-- Pro košík: které způsoby předem prodejce má (jen ano/ne, samotné údaje ne). Košík jde i bez přihlášení.
create or replace function public.seller_prepay_kinds(ids uuid[])
returns table (seller_id uuid, bank boolean, paypal boolean, revolut boolean)
  language sql stable security definer set search_path = '' as $$
  select p.id,
    p.pay_transfer and exists (select 1 from public.seller_payment a where a.user_id = p.id),
    coalesce(x.paypal_me is not null, false),
    coalesce(x.revtag is not null, false)
  from public.profiles p
  left join public.seller_payment_apps x on x.user_id = p.id
  where p.id = any(ids[1:100]);
$$;
grant execute on function public.seller_prepay_kinds(uuid[]) to anon, authenticated;

-- Údaje k platbě předem pro účastníky potvrzené objednávky: účet (je-li převod zapnutý), PayPal, Revolut.
create or replace function public.order_prepay(target uuid)
returns table (iban text, account_name text, paypal_me text, revtag text, amount int, vs bigint)
  language sql stable security definer set search_path = '' as $$
  select case when pr.pay_transfer then a.iban end, case when pr.pay_transfer then a.account_name end,
    x.paypal_me, x.revtag, o.total_czk, o.number
  from public.orders o
  join public.profiles pr on pr.id = o.seller_id
  left join public.seller_payment a on a.user_id = o.seller_id
  left join public.seller_payment_apps x on x.user_id = o.seller_id
  where o.id = target and auth.uid() in (o.buyer_id, o.seller_id)
    and o.status in ('confirmed', 'shipped')
    and coalesce(o.payment, 'transfer') = 'transfer'
    and o.ship_change_czk is null;
$$;
revoke execute on function public.order_prepay(uuid) from public, anon;
grant execute on function public.order_prepay(uuid) to authenticated;

create or replace function public.seller_ready(p_seller uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select
    -- doručení: osobní předání nebo aspoň jeden dopravce
    (p.pickup or exists (select 1 from public.seller_shipping_methods m where m.seller_id = p.id))
    -- platba: předem (převod, PayPal, Revolut), hotově při předání, nebo dobírka u některého dopravce
    and (
      public.seller_prepay(p.id)
      or (p.cash_on_pickup and p.pickup)
      or exists (select 1 from public.seller_shipping_methods m where m.seller_id = p.id and m.cod)
    )
  from public.profiles p where p.id = p_seller;
$$;

-- place_order: platba „transfer“ = předem, stačí převod, PayPal nebo Revolut.
create or replace function public.place_order(items jsonb, choices jsonb)
 returns setof uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
      if not public.seller_prepay(s.seller_id) then
        raise exception 'Prodejce % nepřijímá platbu předem', p.display_name;
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
$function$;

-- answer_price_offer: přijatý návrh dostane platbu předem i u prodejce jen s PayPalem nebo Revolutem.
create or replace function public.answer_price_offer(p_offer uuid, p_action text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_me uuid := auth.uid();
  o public.price_offers;
  l public.listings;
  v_sub int;
  v_ship int;
  v_fee int := 0;
  v_delivery text;
  v_payment text;
  m public.seller_shipping_methods;
  p public.profiles;
  v_transfer boolean;
  v_order uuid;
  v_number bigint;
  v_name text;
begin
  if v_me is null then raise exception 'Přihlaste se.'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření.'; end if;
  select * into o from public.price_offers where id = p_offer for update;
  if not found or v_me not in (o.buyer_id, o.seller_id) then raise exception 'Návrh neexistuje.'; end if;
  if o.status <> 'open' or o.expires_at < now() then raise exception 'Návrh už neplatí.'; end if;
  v_name := public.offer_card_name(o.listing_id);

  if p_action = 'decline' then
    if v_me <> o.seller_id then raise exception 'Kupující návrh zruší, ne odmítne.'; end if;
    update public.price_offers set status = 'declined', updated_at = now() where id = o.id returning * into o;
    perform public.offer_chat(o, v_me, 'Prodejce '
      || case when o.last_by = v_me then 'stáhl' else 'odmítl' end || ' návrh ceny za ' || v_name, null);
    return null;
  elsif p_action = 'cancel' then
    if v_me <> o.buyer_id then raise exception 'Prodejce návrh odmítne, ne zruší.'; end if;
    update public.price_offers set status = 'cancelled', updated_at = now() where id = o.id returning * into o;
    perform public.offer_chat(o, v_me, 'Kupující '
      || case when o.last_by = v_me then 'stáhl' else 'odmítl' end || ' návrh ceny za ' || v_name, null);
    return null;
  elsif p_action <> 'accept' then
    raise exception 'Neznámá akce.';
  end if;

  if o.last_by = v_me then raise exception 'Čeká se na odpověď druhé strany.'; end if;
  select * into l from public.listings where id = o.listing_id for update;
  if not found or l.quantity < o.quantity then raise exception 'Karta už není k dispozici.'; end if;

  v_sub := o.price_czk * o.quantity;
  select * into p from public.profiles where id = o.seller_id;
  v_transfer := public.seller_prepay(o.seller_id);
  if v_transfer then
    select * into m from public.seller_shipping_methods where seller_id = o.seller_id order by price_czk, carrier limit 1;
  else
    select * into m from public.seller_shipping_methods where seller_id = o.seller_id and cod order by price_czk, carrier limit 1;
  end if;
  if m.carrier is not null then
    v_delivery := 'ship';
    v_ship := case when p.free_shipping_from is not null and v_sub >= p.free_shipping_from then 0 else m.price_czk end;
    v_payment := case when v_transfer then 'transfer' else 'cod' end;
    if v_payment = 'cod' then v_fee := m.cod_fee_czk; end if;
  elsif coalesce(p.pickup, false) then
    v_delivery := 'pickup';
    v_ship := 0;
    v_payment := case when v_transfer then 'transfer' when p.cash_on_pickup then 'cash' else null end;
  else
    v_delivery := 'ship';
    v_ship := 0;
    v_payment := null;
  end if;
  update public.price_offers set status = 'accepted', updated_at = now() where id = o.id;
  update public.listings set quantity = quantity - o.quantity where id = l.id;
  insert into public.orders (buyer_id, seller_id, status, total_czk, shipping_czk, cod_fee_czk, delivery, payment, carrier, carrier_label)
    values (o.buyer_id, o.seller_id, 'confirmed', v_sub + v_ship + v_fee, v_ship, v_fee, v_delivery, v_payment, m.carrier, m.label)
    returning id, number into v_order, v_number;
  insert into public.order_items (order_id, listing_id, quantity, price_czk)
    values (v_order, l.id, o.quantity, o.price_czk);
  update public.price_offers set order_id = v_order where id = o.id returning * into o;
  perform public.offer_chat(o, v_me,
    case when v_me = o.seller_id then 'Prodejce' else 'Kupující' end
      || ' přijal cenu ' || o.price_czk || ' Kč za ' || v_name || ', vznikla objednávka č. ' || v_number, null);
  return v_order;
end;
$function$;
