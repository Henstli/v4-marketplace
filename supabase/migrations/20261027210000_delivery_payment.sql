-- Doprava a platba prodejce (DS DeliveryPayment, Šimon 27. 10.): dopravci s cenou a dobírkou,
-- hotově při osobním předání, místo předání na mapě. Kupující v košíku volí dopravu a platbu
-- a objednávka podle toho prochází kroky Zaplaceno → Platba přišla → Odesláno → Převzato.
-- V4cards peníze nepřijímá, platí se přímo prodejci.

alter table public.profiles
  add column pay_transfer boolean not null default true,
  add column cash_on_pickup boolean not null default false,
  -- Poloha je zaokrouhlená v aplikaci na ~1 km, přesnou adresu kupující nevidí.
  add column pickup_lat double precision check (pickup_lat between -90 and 90),
  add column pickup_lng double precision check (pickup_lng between -180 and 180),
  add column pickup_radius_km smallint check (pickup_radius_km between 1 and 50);

-- Dopravci prodejce. Ceník je veřejný (vidí ho kupující v košíku), mění ho jen prodejce.
create table public.seller_shipping_methods (
  seller_id uuid not null references public.profiles(id) on delete cascade,
  carrier text not null check (carrier in ('zasilkovna', 'zasilkovna_home', 'balikovna', 'cp_doruky', 'ppl', 'dpd', 'gls', 'letter', 'custom')),
  label text check (char_length(label) between 2 and 40),
  price_czk int not null check (price_czk between 0 and 1000),
  cod boolean not null default false,
  cod_fee_czk int not null default 0 check (cod_fee_czk between 0 and 500),
  primary key (seller_id, carrier),
  check (carrier <> 'custom' or label is not null)
);
alter table public.seller_shipping_methods enable row level security;
grant select on public.seller_shipping_methods to anon, authenticated;
grant insert, update, delete on public.seller_shipping_methods to authenticated;
create policy "ceník vidí všichni" on public.seller_shipping_methods for select to anon, authenticated using (true);
create policy "ceník mění prodejce" on public.seller_shipping_methods for insert to authenticated with check (seller_id = auth.uid());
create policy "ceník upravuje prodejce" on public.seller_shipping_methods for update to authenticated using (seller_id = auth.uid()) with check (seller_id = auth.uid());
create policy "ceník maže prodejce" on public.seller_shipping_methods for delete to authenticated using (seller_id = auth.uid());
create policy "ceník po dvoufázovém ověření" on public.seller_shipping_methods as restrictive for insert to authenticated with check (public.mfa_ok());
create policy "úprava ceníku po dvoufázovém ověření" on public.seller_shipping_methods as restrictive for update to authenticated using (public.mfa_ok());
create policy "mazání ceníku po dvoufázovém ověření" on public.seller_shipping_methods as restrictive for delete to authenticated using (public.mfa_ok());

-- Prodejci, kteří už něco vystavili, dostanou dosavadní jednotnou cenu jako „Doprava podle domluvy“,
-- aby se u jejich nabídek dalo dál objednat. Upraví si ji v nastavení.
insert into public.seller_shipping_methods (seller_id, carrier, label, price_czk)
select p.id, 'custom', 'Doprava podle domluvy', p.shipping_czk
from public.profiles p
where exists (select 1 from public.listings l where l.seller_id = p.id)
on conflict do nothing;

-- Volba kupujícího a průběh objednávky.
alter table public.orders
  add column payment text check (payment in ('transfer', 'cod', 'cash')),
  add column carrier text,
  add column carrier_label text check (char_length(carrier_label) <= 60),
  add column pickup_point text check (char_length(pickup_point) <= 120),
  add column cod_fee_czk int not null default 0,
  add column buyer_paid_at timestamptz,
  add column tracking text check (char_length(tracking) <= 60);

-- Má prodejce aspoň jeden způsob platby a jeden způsob doručení? Bez toho nejde vystavit.
create or replace function public.seller_ready(p_seller uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select
    -- doručení: osobní předání nebo aspoň jeden dopravce
    (p.pickup or exists (select 1 from public.seller_shipping_methods m where m.seller_id = p.id))
    -- platba: převod s účtem, hotově při předání, nebo dobírka u některého dopravce
    and (
      (p.pay_transfer and exists (select 1 from public.seller_payment a where a.user_id = p.id))
      or (p.cash_on_pickup and p.pickup)
      or exists (select 1 from public.seller_shipping_methods m where m.seller_id = p.id and m.cod)
    )
  from public.profiles p where p.id = p_seller;
$$;
revoke execute on function public.seller_ready(uuid) from public, anon;
grant execute on function public.seller_ready(uuid) to authenticated;

create policy "vystavit jen s dopravou a platbou" on public.listings as restrictive for insert to authenticated
  with check (coalesce(public.seller_ready(auth.uid()), false));

-- Platební údaje jen u objednávky placené převodem (starší objednávky bez volby se berou jako převod),
-- dokud platba nepřišla.
create or replace function public.order_payment(target uuid)
returns table (iban text, account_name text, amount int, vs bigint)
  language sql stable security definer set search_path = '' as $$
  select p.iban, p.account_name, o.total_czk, o.number
  from public.orders o
  join public.seller_payment p on p.user_id = o.seller_id
  where o.id = target and auth.uid() in (o.buyer_id, o.seller_id)
    and o.status in ('confirmed', 'shipped')
    and coalesce(o.payment, 'transfer') = 'transfer';
$$;

-- Objednávka s volbou dopravy a platby u každého prodejce:
-- choices = {"<seller_id>": {"delivery": "pickup" | "<carrier>", "payment": "transfer" | "cod" | "cash", "point": "výdejní místo"}}
create function public.place_order(items jsonb, choices jsonb) returns setof uuid
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

    insert into public.orders (buyer_id, seller_id, status, total_czk, shipping_czk, cod_fee_czk, expires_at, delivery,
      payment, carrier, carrier_label, pickup_point)
    values (buyer, s.seller_id, 'requested', s.subtotal + ship + fee, ship, fee,
      now() + make_interval(hours => public.request_hours()),
      case when v_delivery = 'pickup' then 'pickup' else 'ship' end,
      v_payment, m.carrier, m.label, nullif(left(trim(c->>'point'), 120), ''))
    returning id into order_id;
    insert into public.order_items (order_id, listing_id, quantity, price_czk)
    select order_id, listing_id, quantity, price from _items where seller_id = s.seller_id;
    return next order_id;
  end loop;
end;
$$;
revoke execute on function public.place_order(jsonb, jsonb) from public, anon;
grant execute on function public.place_order(jsonb, jsonb) to authenticated;

-- Přechody stavů podle platby a doručení (DS DeliveryPayment):
--   převod + dopravce:   potvrzeno → (kupující Zaplaceno) → platba přišla → odesláno → převzato
--   dobírka:             potvrzeno → odesláno → převzato
--   převod + předání:    potvrzeno → (Zaplaceno) → platba přišla → převzato
--   hotově při předání:  potvrzeno → předáno (potvrzuje prodejce, peníze dostal on)
-- Objednávka bez volby (starší, nebo z návrhu ceny) se bere jako převod.
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
  -- prodejce: platba přišla
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'paid' and pay = 'transfer' then
    update public.orders set status = 'paid', buyer_paid_at = coalesce(buyer_paid_at, now()) where id = target;
  -- prodejce: odesláno (po zaplacení, nebo rovnou u dobírky)
  elsif o.seller_id = me and o.delivery = 'ship' and next_status = 'shipped'
      and ((o.status = 'paid' and pay = 'transfer') or (o.status = 'confirmed' and pay = 'cod')) then
    update public.orders set status = 'shipped' where id = target;
  -- prodejce: předáno a zaplaceno hotově
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'delivered' and o.delivery = 'pickup' and pay = 'cash' then
    update public.orders set status = 'delivered' where id = target;
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'cancelled' then
    update public.orders set status = 'cancelled' where id = target;
    perform public.release_order_items(target);
  elsif o.buyer_id = me and o.status = 'requested' and next_status = 'cancelled' then
    update public.orders set status = 'cancelled' where id = target;
    perform public.release_order_items(target);
  -- kupující: převzato po odeslání, u osobního předání po zaplacení převodem
  elsif o.buyer_id = me and next_status = 'delivered'
      and (o.status = 'shipped' or (o.status = 'paid' and o.delivery = 'pickup')) then
    update public.orders set status = 'delivered' where id = target;
  else
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
end;
$$;

-- Kupující: „Zaplaceno“ (poslal převod). Stav zůstává potvrzeno, dokud prodejce neuvidí peníze.
create or replace function public.mark_order_paid(target uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.buyer_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or coalesce(o.payment, 'transfer') <> 'transfer' then raise exception 'Tuto změnu stavu nelze provést'; end if;
  if o.buyer_paid_at is not null then return; end if;
  update public.orders set buyer_paid_at = now() where id = target;
  perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
    'Kupující zaplatil objednávku č. ' || o.number, o.id);
end;
$$;
revoke execute on function public.mark_order_paid(uuid) from public, anon;
grant execute on function public.mark_order_paid(uuid) to authenticated;

-- Prodejce: „Nepřišla“ — platbu zatím nevidí, kupující to uvidí v chatu a může zaplatit znovu.
create or replace function public.payment_not_received(target uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.seller_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or o.buyer_paid_at is null then raise exception 'Tuto změnu stavu nelze provést'; end if;
  update public.orders set buyer_paid_at = null where id = target;
  perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.seller_id, 'status',
    'Prodejce zatím nevidí platbu za objednávku č. ' || o.number, o.id);
end;
$$;
revoke execute on function public.payment_not_received(uuid) from public, anon;
grant execute on function public.payment_not_received(uuid) to authenticated;

-- Prodejce: číslo zásilky (při odeslání nebo kdykoli potom).
create or replace function public.set_order_tracking(target uuid, p_tracking text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  update public.orders set tracking = nullif(left(trim(p_tracking), 60), '')
  where id = target and seller_id = auth.uid() and status in ('paid', 'shipped', 'confirmed', 'delivered');
  if not found then raise exception 'Objednávka neexistuje'; end if;
end;
$$;
revoke execute on function public.set_order_tracking(uuid, text) from public, anon;
grant execute on function public.set_order_tracking(uuid, text) to authenticated;

-- Texty změn v chatu: platba přišla a předání.
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
    when 'paid' then 'Prodejce potvrdil platbu za objednávku č. '
    when 'shipped' then 'Prodejce odeslal objednávku č. '
    when 'delivered' then case when new.delivery = 'pickup' then 'Předána objednávka č. ' else 'Kupující převzal objednávku č. ' end
    else null end;
  if v_body is null then return new; end if;
  v_conv := public.conversation_for(new.buyer_id, new.seller_id);
  perform public.post_message(v_conv, auth.uid(), 'status', v_body || new.number, new.id);
  return new;
end;
$$;
