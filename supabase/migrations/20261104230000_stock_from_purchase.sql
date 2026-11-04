-- Koupě na V4cards: když kupující převezme objednávku (stav Převzato), karty se mu samy přidají do skladu
-- nebo sbírky jako kusy mimo prodej a nákupní cena se doplní podle ceny v objednávce.
-- Nákupní cenu jde vždy ručně přepsat. Když už řádek se stejnou kartou, stavem a jazykem má nákupní cenu
-- (napsanou ručně), nepřepisuje se.

create or replace function public.stock_from_purchase() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  it record;
  row_id uuid;
  undo jsonb := '[]'::jsonb;
  sample jsonb := '[]'::jsonb;
  n int := 0;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;
  begin
    for it in
      select oi.quantity, oi.price_czk, l.card_id, l.condition, l.language, l.graded, c.name
        from public.order_items oi
        join public.listings l on l.id = oi.listing_id
        join public.cards c on c.id = l.card_id
       where oi.order_id = new.id
    loop
      select b.id into row_id from public.listings b
       where b.seller_id = new.buyer_id and b.card_id = it.card_id and b.condition = it.condition
         and b.language = it.language and b.graded is not distinct from it.graded and b.removed_at is null
       order by b.created_at limit 1;
      if row_id is null then
        insert into public.listings (card_id, seller_id, price_czk, negotiable, condition, language, quantity, graded)
        values (it.card_id, new.buyer_id, null, true, it.condition, it.language, 0, it.graded)
        returning id into row_id;
        undo := undo || jsonb_build_array(jsonb_build_object('id', row_id, 'price_czk', null, 'negotiable', true,
          'quantity', 0, 'keep_qty', 0, 'trade_qty', 0, 'location', null));
      else
        undo := undo || (select jsonb_build_array(jsonb_build_object('id', l.id, 'price_czk', l.price_czk, 'negotiable', l.negotiable,
            'quantity', l.quantity, 'keep_qty', s.keep_qty, 'trade_qty', s.trade_qty, 'location', s.location))
          from public.listings l join public.listing_stock s on s.listing_id = l.id where l.id = row_id);
      end if;
      insert into public.listing_stock (listing_id, seller_id) values (row_id, new.buyer_id) on conflict do nothing;
      update public.listing_stock
         set keep_qty = least(100000, keep_qty + it.quantity),
             buy_price_czk = coalesce(buy_price_czk, it.price_czk),
             updated_at = now()
       where listing_id = row_id;
      n := n + it.quantity;
      if jsonb_array_length(sample) < 20 then
        sample := sample || jsonb_build_array(jsonb_build_array(it.name, '', it.quantity || ' ks za ' || it.price_czk || ' Kč'));
      end if;
    end loop;
    if n > 0 then
      insert into public.stock_events (owner_id, actor_id, kind, title, detail, undo, sample)
      values (new.buyer_id, new.buyer_id, 'stock',
        'Koupeno na V4cards: ' || n || ' ks', 'Objednávka ' || left(new.id::text, 8), undo, sample);
    end if;
  exception when others then
    -- Přidání do skladu nesmí zablokovat převzetí objednávky.
    raise warning 'stock_from_purchase %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger orders_stock_from_purchase after update of status on public.orders
  for each row execute function public.stock_from_purchase();

-- Historie v detailu karty: víc událostí (detail ukazuje 5 a zbytek po rozbalení).
create or replace function public.stock_row_events(p_listing uuid)
  returns table (id bigint, created_at timestamptz, kind text, title text) language sql stable security definer set search_path = '' as $$
  select e.id, e.created_at, e.kind, e.title
    from public.stock_events e
    join public.listings l on l.id = p_listing
   where e.owner_id = l.seller_id and public.stock_perm(l.seller_id, 'view')
     and e.undo @> jsonb_build_array(jsonb_build_object('id', p_listing))
   order by e.created_at desc
   limit 50
$$;
grant execute on function public.stock_row_events(uuid) to authenticated;
