-- Cena dopravy (DS DeliveryPayment, Šimon 27. 10.): strop podle ceníku dopravce a úprava dopravy
-- u konkrétní objednávky. API dopravců ne, ceny má každý prodejce podle své smlouvy.
--   strop v nastavení: ceník dopravce + 25 Kč na balné, dobírka ceník + 10 Kč; vlastní způsob bez stropu
--   úprava u objednávky: jen před zaplacením, s důvodem; zvýšení musí kupující potvrdit,
--   snížení platí hned. Strop zvýšení: ceník větší zásilky + 25 Kč.

-- Ceníky dopravců pro lidi (s DPH). Mění je jen V4cards, když dopravce zdraží.
create table public.carrier_rates (
  carrier text primary key check (carrier in ('zasilkovna', 'zasilkovna_home', 'balikovna', 'cp_doruky', 'ppl', 'dpd', 'gls', 'letter')),
  name text not null,
  price_czk int not null check (price_czk between 0 and 1000),
  -- příplatek dopravce za dobírku; null = dobírku nehlídáme
  cod_fee_czk int check (cod_fee_czk between 0 and 500),
  -- ceník větší nebo těžší zásilky (strop úpravy u objednávky)
  heavy_czk int not null check (heavy_czk between 0 and 1000),
  updated_at timestamptz not null default now()
);
alter table public.carrier_rates enable row level security;
grant select on public.carrier_rates to anon, authenticated;
create policy "ceníky dopravců vidí všichni" on public.carrier_rates for select to anon, authenticated using (true);

-- Orientační ceníky k 27. 10. 2026, před spuštěním ověřit na webech dopravců.
insert into public.carrier_rates (carrier, name, price_czk, cod_fee_czk, heavy_czk) values
  ('zasilkovna', 'Zásilkovna · výdejní místo a Z-BOX', 89, 26, 149),
  ('zasilkovna_home', 'Zásilkovna · na adresu', 129, 26, 179),
  ('balikovna', 'Balíkovna', 89, 29, 139),
  ('cp_doruky', 'Česká pošta · Balík Do ruky', 139, 29, 199),
  ('ppl', 'PPL', 189, 46, 284),
  ('dpd', 'DPD', 169, 45, 249),
  ('gls', 'GLS', 169, 45, 249),
  ('letter', 'Doporučený dopis', 83, null, 120);

create or replace function public.shipping_packing_czk() returns int language sql immutable as 'select 25';
create or replace function public.cod_margin_czk() returns int language sql immutable as 'select 10';

-- Strop v nastavení dopravy prodejce.
create or replace function public.check_shipping_cap() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  r public.carrier_rates;
begin
  select * into r from public.carrier_rates where carrier = new.carrier;
  if not found then return new; end if;
  if new.price_czk > r.price_czk + public.shipping_packing_czk() then
    raise exception '%: nejvýš % Kč (ceník % Kč + % Kč balné).', r.name,
      r.price_czk + public.shipping_packing_czk(), r.price_czk, public.shipping_packing_czk() using errcode = 'P0001';
  end if;
  if new.cod and r.cod_fee_czk is not null and new.cod_fee_czk > r.cod_fee_czk + public.cod_margin_czk() then
    raise exception '%: příplatek za dobírku nejvýš % Kč (ceník % Kč + % Kč).', r.name,
      r.cod_fee_czk + public.cod_margin_czk(), r.cod_fee_czk, public.cod_margin_czk() using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger shipping_cap before insert or update on public.seller_shipping_methods
  for each row execute function public.check_shipping_cap();

-- Navržená změna dopravy čekající na kupujícího.
alter table public.orders
  add column ship_change_czk int check (ship_change_czk between 0 and 1000),
  add column ship_change_reason text check (char_length(ship_change_reason) <= 200);

-- Prodejce: upravit dopravu u objednávky (jen potvrzená, před zaplacením, ne osobní předání).
create or replace function public.change_order_shipping(target uuid, p_price int, p_reason text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  r public.carrier_rates;
  v_reason text := nullif(left(trim(p_reason), 200), '');
  v_cap int;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.seller_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or o.delivery <> 'ship' or o.buyer_paid_at is not null then
    raise exception 'Dopravu jde upravit jen u potvrzené objednávky před zaplacením';
  end if;
  if p_price is null or p_price < 0 or p_price > 1000 then raise exception 'Cena dopravy musí být 0 až 1 000 Kč'; end if;
  if v_reason is null or char_length(v_reason) < 3 then raise exception 'Napište kupujícímu důvod'; end if;
  if p_price = o.shipping_czk then
    -- návrat na původní cenu = zrušení čekající změny
    if o.ship_change_czk is null then raise exception 'Cena dopravy je stejná'; end if;
    update public.orders set ship_change_czk = null, ship_change_reason = null where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.seller_id, 'status',
      'Prodejce vzal zpět změnu dopravy u objednávky č. ' || o.number, o.id);
    return;
  end if;

  if p_price < o.shipping_czk then
    update public.orders set total_czk = total_czk - (shipping_czk - p_price), shipping_czk = p_price,
      ship_change_czk = null, ship_change_reason = null where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.seller_id, 'status',
      'Prodejce snížil dopravu u objednávky č. ' || o.number || ': ' || o.shipping_czk || ' → ' || p_price || ' Kč · ' || v_reason, o.id);
    return;
  end if;

  select * into r from public.carrier_rates where carrier = o.carrier;
  if found then
    v_cap := greatest(r.heavy_czk, r.price_czk) + public.shipping_packing_czk();
    if p_price > v_cap then
      raise exception 'Nejvýš % Kč (ceník větší zásilky % Kč + % Kč balné)', v_cap, greatest(r.heavy_czk, r.price_czk), public.shipping_packing_czk();
    end if;
  end if;
  update public.orders set ship_change_czk = p_price, ship_change_reason = v_reason where id = target;
  perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.seller_id, 'status',
    'Prodejce změnil dopravu u objednávky č. ' || o.number || ': ' || o.shipping_czk || ' → ' || p_price || ' Kč · ' || v_reason, o.id);
end;
$$;
revoke execute on function public.change_order_shipping(uuid, int, text) from public, anon;
grant execute on function public.change_order_shipping(uuid, int, text) to authenticated;

-- Kupující: souhlasí se zvýšenou dopravou, nebo objednávku zruší (karty se vrátí do nabídky).
create or replace function public.answer_shipping_change(target uuid, p_accept boolean) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.buyer_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or o.ship_change_czk is null then raise exception 'Změna dopravy už neplatí'; end if;
  if p_accept then
    update public.orders set total_czk = total_czk + (ship_change_czk - shipping_czk), shipping_czk = ship_change_czk,
      ship_change_czk = null, ship_change_reason = null where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
      'Kupující souhlasil se změnou dopravy u objednávky č. ' || o.number, o.id);
  else
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
      'Kupující nesouhlasil se změnou dopravy u objednávky č. ' || o.number, o.id);
    update public.orders set status = 'cancelled', ship_change_czk = null, ship_change_reason = null where id = target;
    perform public.release_order_items(target);
  end if;
end;
$$;
revoke execute on function public.answer_shipping_change(uuid, boolean) from public, anon;
grant execute on function public.answer_shipping_change(uuid, boolean) to authenticated;

-- Dokud kupující změnu nepotvrdí, nejde zaplatit, potvrdit platbu ani odeslat.
create or replace function public.guard_ship_change() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if old.ship_change_czk is not null and new.ship_change_czk is not null
      and (new.status in ('paid', 'shipped', 'delivered') or (new.buyer_paid_at is not null and old.buyer_paid_at is null)) then
    raise exception 'Kupující ještě nepotvrdil změnu dopravy';
  end if;
  return new;
end;
$$;
create trigger guard_ship_change before update on public.orders
  for each row execute function public.guard_ship_change();

-- Platební údaje (QR) až po potvrzení změny dopravy.
create or replace function public.order_payment(target uuid)
returns table (iban text, account_name text, amount int, vs bigint)
  language sql stable security definer set search_path = '' as $$
  select p.iban, p.account_name, o.total_czk, o.number
  from public.orders o
  join public.seller_payment p on p.user_id = o.seller_id
  where o.id = target and auth.uid() in (o.buyer_id, o.seller_id)
    and o.status in ('confirmed', 'shipped')
    and coalesce(o.payment, 'transfer') = 'transfer'
    and o.ship_change_czk is null;
$$;

-- Osobní předání na přesném místě (obchod, pobočka): kupující vidí adresu, poloha se nezaokrouhluje.
alter table public.profiles add column pickup_exact boolean not null default false;
