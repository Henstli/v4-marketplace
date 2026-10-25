-- Objednávky: vytvoření z košíku a změny stavu. Běží jako security definer,
-- aby šlo atomicky odečíst kusy z cizích nabídek; každá funkce si sama hlídá, kdo ji volá.

-- Doprava za jednu zásilku od prodejce (stejná hodnota jako v košíku na webu).
create or replace function public.shipping_per_seller() returns int
  language sql immutable set search_path = '' as $$ select 89 $$;

create or replace function public.place_order(items jsonb) returns setof uuid
  language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  item record;
  l public.listings;
  seller uuid;
  order_id uuid;
begin
  if buyer is null then raise exception 'Nejste přihlášeni'; end if;
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

  for seller in select distinct seller_id from _items loop
    -- Platby zatím nejsou, objednávka je rovnou zaplacená (testovací režim).
    insert into public.orders (buyer_id, seller_id, status, total_czk, shipping_czk)
    select buyer, seller, 'paid', sum(price * quantity) + public.shipping_per_seller(), public.shipping_per_seller()
    from _items where seller_id = seller
    returning id into order_id;
    insert into public.order_items (order_id, listing_id, quantity, price_czk)
    select order_id, listing_id, quantity, price from _items where seller_id = seller;
    return next order_id;
  end loop;
end;
$$;

-- Prodejce označí zaplacenou objednávku jako odeslanou, kupující odeslanou jako doručenou.
create or replace function public.set_order_status(target uuid, next_status public.order_status) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = target for update;
  if not found then raise exception 'Objednávka neexistuje'; end if;
  if next_status = 'shipped' and o.status = 'paid' and o.seller_id = auth.uid() then
    update public.orders set status = 'shipped' where id = target;
  elsif next_status = 'delivered' and o.status = 'shipped' and o.buyer_id = auth.uid() then
    update public.orders set status = 'delivered' where id = target;
  else
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
end;
$$;

revoke execute on function public.place_order(jsonb) from public, anon;
revoke execute on function public.set_order_status(uuid, public.order_status) from public, anon;
grant execute on function public.place_order(jsonb) to authenticated;
grant execute on function public.set_order_status(uuid, public.order_status) to authenticated;

-- Hodnocení musí patřit prodejci z dané objednávky (doplňuje pravidlo „hodnotí kupující“).
create policy "hodnocení jen prodejce z objednávky" on public.reviews as restrictive for insert
  with check (exists (
    select 1 from public.orders o where o.id = order_id and o.seller_id = reviews.seller_id
  ));
