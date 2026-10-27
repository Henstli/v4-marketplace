-- Žádosti o objednávku: kupující odešle závaznou objednávku, každý prodejce ji do 48 hodin potvrdí nebo odmítne.
-- Kusy jsou po dobu žádosti rezervované (zmizí z nabídky), po odmítnutí, zrušení nebo vypršení se vrátí.

alter table public.orders
  add column expires_at timestamptz,
  add column decided_at timestamptz;

create index orders_requested_expiry_idx on public.orders (expires_at) where status = 'requested';

-- Kolik nevyřízených žádostí smí mít jeden kupující najednou (ochrana proti blokování cizího zboží).
create or replace function public.max_open_requests() returns int
  language sql immutable set search_path = '' as $$ select 10 $$;

create or replace function public.request_hours() returns int
  language sql immutable set search_path = '' as $$ select 48 $$;

create or replace function public.place_order(items jsonb) returns setof uuid
  language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  item record;
  l public.listings;
  seller uuid;
  order_id uuid;
  open_count int;
begin
  if buyer is null then raise exception 'Nejste přihlášeni'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'Košík je prázdný'; end if;

  create temp table _items (listing_id uuid, seller_id uuid, quantity int, price int) on commit drop;

  for item in select (e->>'listing_id')::uuid as listing_id, (e->>'quantity')::int as quantity from jsonb_array_elements(items) e loop
    select * into l from public.listings where id = item.listing_id for update;
    if not found then raise exception 'Nabídka už neexistuje'; end if;
    if l.seller_id = buyer then raise exception 'Nelze koupit vlastní nabídku'; end if;
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

  for seller in select distinct seller_id from _items loop
    insert into public.orders (buyer_id, seller_id, status, total_czk, shipping_czk, expires_at)
    select buyer, seller, 'requested', sum(price * quantity) + public.shipping_per_seller(), public.shipping_per_seller(),
      now() + make_interval(hours => public.request_hours())
    from _items where seller_id = seller
    returning id into order_id;
    insert into public.order_items (order_id, listing_id, quantity, price_czk)
    select order_id, listing_id, quantity, price from _items where seller_id = seller;
    return next order_id;
  end loop;
end;
$$;

-- Vrátí rezervované kusy zpět do nabídky (nabídka mezitím mohla zmizet, pak se nic nevrací).
create or replace function public.release_order_items(target uuid) returns void
  language sql security definer set search_path = '' as $$
  update public.listings l set quantity = l.quantity + i.quantity
  from public.order_items i where i.order_id = target and i.listing_id = l.id;
$$;
revoke execute on function public.release_order_items(uuid) from public, anon, authenticated;

-- Přechody stavů:
--   prodejce: žádost → potvrzeno / odmítnuto, potvrzeno → odesláno / zrušeno (kupující nezaplatil)
--   kupující: žádost → zrušeno, potvrzeno nebo odesláno → převzato (osobní předání jde rovnou z potvrzeno)
create or replace function public.set_order_status(target uuid, next_status public.order_status) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  me uuid := auth.uid();
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found then raise exception 'Objednávka neexistuje'; end if;

  if o.seller_id = me and o.status = 'requested' and next_status in ('confirmed', 'declined') then
    if o.expires_at < now() then raise exception 'Na objednávku už vypršel čas'; end if;
    update public.orders set status = next_status, decided_at = now() where id = target;
    if next_status = 'declined' then perform public.release_order_items(target); end if;
  elsif o.seller_id = me and o.status in ('confirmed', 'paid') and next_status = 'shipped' then
    update public.orders set status = 'shipped' where id = target;
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'cancelled' then
    update public.orders set status = 'cancelled' where id = target;
    perform public.release_order_items(target);
  elsif o.buyer_id = me and o.status = 'requested' and next_status = 'cancelled' then
    update public.orders set status = 'cancelled' where id = target;
    perform public.release_order_items(target);
  elsif o.buyer_id = me and o.status in ('confirmed', 'shipped') and next_status = 'delivered' then
    update public.orders set status = 'delivered' where id = target;
  else
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
end;
$$;

-- Žádosti, které prodejce včas nepotvrdil, vyprší a kusy se vrátí do nabídky.
create or replace function public.expire_order_requests() returns int
  language plpgsql security definer set search_path = '' as $$
declare
  o record;
  n int := 0;
begin
  for o in select id from public.orders where status = 'requested' and expires_at < now() for update skip locked loop
    update public.orders set status = 'expired' where id = o.id;
    perform public.release_order_items(o.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.expire_order_requests() from public, anon, authenticated;

select cron.schedule('expire-order-requests', '*/10 * * * *', $$select public.expire_order_requests()$$);

-- Kontakt na druhou stranu objednávky: e-mail pro upozornění a domluvu platby a předání.
create or replace function public.order_counterpart(target uuid)
returns table (email text, name text)
  language sql stable security definer set search_path = '' as $$
  select u.email::text, p.display_name
  from public.orders o
  join public.profiles p on p.id = case when o.buyer_id = auth.uid() then o.seller_id else o.buyer_id end
  join auth.users u on u.id = p.id
  where o.id = target and auth.uid() in (o.buyer_id, o.seller_id);
$$;
revoke execute on function public.order_counterpart(uuid) from public, anon;
grant execute on function public.order_counterpart(uuid) to authenticated;
