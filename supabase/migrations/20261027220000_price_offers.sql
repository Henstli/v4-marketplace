-- Cena dohodou a smlouvání.
-- Nabídka (listing) může mít místo ceny „cenu dohodou“. Kupující pošle návrh ceny, prodejce ho přijme,
-- odmítne, nebo pošle protinávrh; stejně tak kupující. Prodejce může sám navrhnout cenu komukoli,
-- s kým si píše (u kterékoli své nabídky). Návrh platí 48 hodin od poslední změny.
-- Do přijetí se nic nerezervuje. Přijetím vznikne rovnou potvrzená objednávka a ubudou kusy;
-- když dojdou, ostatní otevřené návrhy na tu nabídku se zavřou (prodejce nemůže prodat jednu kartu dvakrát).

-- Cena dohodou: price_czk je prázdná. Pevná cena: price_czk vyplněná.
alter table public.listings add column negotiable boolean not null default false;
alter table public.listings alter column price_czk drop not null;
alter table public.listings add constraint listings_price_or_negotiable
  check ((negotiable and price_czk is null) or (not negotiable and price_czk is not null));

create table public.price_offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  quantity int not null check (quantity between 1 and 999),
  price_czk int not null check (price_czk between 1 and 10000000),
  -- Kdo navrhl současnou cenu; přijmout ji může jen druhá strana.
  last_by uuid not null,
  -- open = čeká na druhou stranu, accepted = vznikla objednávka, declined = prodejce odmítl nebo stáhl,
  -- cancelled = kupující odmítl nebo stáhl, expired = 48 h bez odpovědi, sold_out = karta se prodala jinde
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'cancelled', 'expired', 'sold_out')),
  expires_at timestamptz not null default now() + interval '48 hours',
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);
-- Mezi kupujícím a nabídkou je nejvýš jeden otevřený návrh.
create unique index price_offers_open_idx on public.price_offers (listing_id, buyer_id) where status = 'open';
create index price_offers_buyer_idx on public.price_offers (buyer_id, updated_at desc);
create index price_offers_seller_idx on public.price_offers (seller_id, updated_at desc);
create index price_offers_expiry_idx on public.price_offers (expires_at) where status = 'open';
alter table public.price_offers enable row level security;
grant select on public.price_offers to authenticated;
create policy "návrhy účastníků" on public.price_offers for select to authenticated
  using (auth.uid() in (buyer_id, seller_id));

-- Zprávy o návrhu ceny: offer_id odkazuje na návrh, offer_price je cena v té zprávě
-- (s cenou = bublina s návrhem, bez ceny = řádek o změně stavu).
alter table public.messages add column offer_id uuid references public.price_offers(id) on delete set null;
alter table public.messages add column offer_price int;

-- Zpráva o návrhu do konverzace kupujícího a prodejce (jen pro funkce níže).
create or replace function public.offer_chat(o public.price_offers, p_sender uuid, p_body text, p_price int)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  v_id := public.post_message(public.conversation_for(o.buyer_id, o.seller_id), p_sender, 'status', p_body, null);
  update public.messages set offer_id = o.id, offer_price = p_price, listing_id = o.listing_id where id = v_id;
end;
$$;
revoke execute on function public.offer_chat(public.price_offers, uuid, text, int) from public, anon, authenticated;

create or replace function public.offer_card_name(p_listing uuid) returns text
  language sql stable security definer set search_path = '' as $$
  select c.name from public.listings l join public.cards c on c.id = l.card_id where l.id = p_listing;
$$;
revoke execute on function public.offer_card_name(uuid) from public, anon, authenticated;

-- Nový návrh ceny, nebo změna ceny v otevřeném návrhu.
-- Kupující: p_buyer = null, nabídka musí mít cenu dohodou. Prodejce: p_buyer = komu cenu navrhuje
-- (jen někomu, s kým už si píše). Vrací id návrhu.
create or replace function public.propose_price(p_listing uuid, p_price int, p_quantity int default 1, p_buyer uuid default null)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  l public.listings;
  o public.price_offers;
  v_buyer uuid;
  v_name text;
begin
  if v_me is null then raise exception 'Pro návrh ceny se přihlaste.'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření.'; end if;
  if p_price is null or p_price < 1 or p_price > 10000000 then raise exception 'Zadejte cenu v korunách.'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'Zadejte počet kusů.'; end if;
  select * into l from public.listings where id = p_listing for update;
  if not found or l.quantity < 1 then raise exception 'Nabídka už není k dispozici.'; end if;
  if p_quantity > l.quantity then raise exception 'Prodejce má jen % ks.', l.quantity; end if;

  if l.seller_id = v_me then
    v_buyer := p_buyer;
    if v_buyer is null or v_buyer = v_me then raise exception 'Vyberte, komu cenu navrhujete.'; end if;
    if not exists (select 1 from public.conversations where user_a = least(v_me, v_buyer) and user_b = greatest(v_me, v_buyer)) then
      raise exception 'Cenu můžete navrhnout jen tomu, s kým si už píšete.';
    end if;
  else
    v_buyer := v_me;
    if p_buyer is not null and p_buyer <> v_me then raise exception 'Cenu může navrhnout jen prodejce nebo kupující.'; end if;
    -- Pevná cena: kupující může jen odpovědět jinou cenou na návrh, který mu poslal prodejce.
    if not l.negotiable and not exists (select 1 from public.price_offers
        where listing_id = l.id and buyer_id = v_me and status = 'open') then
      raise exception 'Tato nabídka má pevnou cenu, přidejte ji do košíku.';
    end if;
  end if;

  -- Ochrana proti spamu: nejvýš 30 návrhů za hodinu.
  if (select count(*) from public.messages
      where sender_id = v_me and offer_price is not null and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Posíláte příliš mnoho návrhů. Zkuste to prosím za chvíli.';
  end if;

  v_name := public.offer_card_name(l.id);
  select * into o from public.price_offers where listing_id = l.id and buyer_id = v_buyer and status = 'open' for update;
  if found then
    update public.price_offers set price_czk = p_price, quantity = p_quantity, last_by = v_me,
      expires_at = now() + interval '48 hours', updated_at = now()
      where id = o.id returning * into o;
    perform public.offer_chat(o, v_me, 'Nová cena ' || p_price || ' Kč za ' || v_name, p_price);
  else
    insert into public.price_offers (listing_id, buyer_id, seller_id, quantity, price_czk, last_by)
      values (l.id, v_buyer, l.seller_id, p_quantity, p_price, v_me) returning * into o;
    perform public.offer_chat(o, v_me, 'Návrh ceny ' || p_price || ' Kč za ' || v_name, p_price);
  end if;
  return o.id;
end;
$$;
revoke execute on function public.propose_price(uuid, int, int, uuid) from public, anon;
grant execute on function public.propose_price(uuid, int, int, uuid) to authenticated;

-- Odpověď na návrh: accept (jen strana, která cenu nenavrhla), decline (prodejce), cancel (kupující).
-- Přijetí vytvoří potvrzenou objednávku. Vrací id objednávky (u přijetí), jinak null.
create or replace function public.answer_price_offer(p_offer uuid, p_action text) returns uuid
  language plpgsql security definer set search_path = '' as $$
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
  -- Doprava a platba (DS DeliveryPayment): nejlevnější dopravce prodejce a převod, když ho přijímá,
  -- jinak dobírka; bez dopravců osobní předání. Jinou domluvu si strany řeknou ve zprávách.
  select * into p from public.profiles where id = o.seller_id;
  v_transfer := coalesce(p.pay_transfer, false) and exists (select 1 from public.seller_payment a where a.user_id = o.seller_id);
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
  -- Nejdřív přijmout, ať ho trigger při vyprodání nezavře jako prodaný jinde.
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
$$;
revoke execute on function public.answer_price_offer(uuid, text) from public, anon;
grant execute on function public.answer_price_offer(uuid, text) to authenticated;

-- Když nabídce dojdou kusy (prodej jinde, přijatý návrh, stažení), otevřené návrhy se zavřou.
create or replace function public.close_offers_sold_out() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  o public.price_offers;
  v_name text;
begin
  if new.quantity > 0 or old.quantity = 0 then return new; end if;
  v_name := public.offer_card_name(new.id);
  for o in update public.price_offers set status = 'sold_out', updated_at = now()
           where listing_id = new.id and status = 'open' returning * loop
    perform public.offer_chat(o, null, 'Karta ' || v_name || ' se prodala, návrh ceny skončil', null);
  end loop;
  return new;
end;
$$;
create trigger listings_close_offers after update of quantity on public.listings
  for each row execute function public.close_offers_sold_out();

-- Návrhy bez odpovědi do 48 hodin vyprší (cron každých 10 minut).
create or replace function public.expire_price_offers() returns int
  language plpgsql security definer set search_path = '' as $$
declare
  o public.price_offers;
  n int := 0;
begin
  for o in update public.price_offers set status = 'expired', updated_at = now()
           where status = 'open' and expires_at < now() returning * loop
    perform public.offer_chat(o, null, 'Návrh ceny ' || o.price_czk || ' Kč za ' || public.offer_card_name(o.listing_id) || ' vypršel bez odpovědi', null);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.expire_price_offers() from public, anon, authenticated;
select cron.schedule('expire-price-offers', '*/10 * * * *', $$select public.expire_price_offers()$$);

-- Hromadná změna ceny: u ceny dohodou procentní změna nic nedělá, pevná cena z ní udělá pevnou nabídku.
create or replace function public.bulk_update_listings(
  p_ids uuid[], p_price_pct numeric default null, p_price int default null, p_quantity int default null
) returns int
language plpgsql security invoker set search_path = '' as $$
declare
  n int;
begin
  if p_price is not null and p_price <= 0 then raise exception 'Cena musí být kladná'; end if;
  if p_quantity is not null and (p_quantity < 0 or p_quantity > 999) then raise exception 'Počet kusů musí být 0 až 999'; end if;
  if p_price_pct is not null and (p_price_pct <= -100 or p_price_pct > 1000) then raise exception 'Změna ceny musí být mezi -99 a 1000 %%'; end if;
  update public.listings
     set price_czk = coalesce(p_price,
           case when p_price_pct is null or price_czk is null then price_czk
                else greatest(1, round(price_czk * (1 + p_price_pct / 100.0))::int) end),
         negotiable = case when p_price is not null then false else negotiable end,
         quantity = coalesce(p_quantity, quantity)
   where id = any(p_ids) and seller_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Košík: nabídku s cenou dohodou (bez ceny) odmítne už place_order z migrace delivery_payment.
