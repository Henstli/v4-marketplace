-- Lehké dotazy skladu: záložky mimo tabulku potřebují jen počty (ne celý souhrn s tržními cenami),
-- Trh jen počty kusů podle karty a Vaše ceny jen karty na prodej. Práva stejná: stock_perm 'view', ověřené jednou za dotaz.

-- Počty v záložkách a pro menu (Všechny karty, Na prodej, celkem řádků, místa, hry).
create or replace function public.stock_counts(p_owner uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  with r as (
    select l.card_id, l.quantity, (l.quantity + coalesce(s.keep_qty, 0) + coalesce(l.hidden_qty, 0)) as own, s.location, c.game_id
      from public.listings l
      left join public.listing_stock s on s.listing_id = l.id
      left join public.cards c on c.id = l.card_id and not c.hidden
     where l.seller_id = p_owner and (select public.stock_perm(p_owner, 'view'))
  )
  select jsonb_build_object(
    'kindsAll', (select count(distinct card_id) from r where own > 0),
    'kindsSale', (select count(distinct card_id) from r where own > 0 and quantity > 0),
    'owned', (select count(*) from r where own > 0),
    'rows', (select count(*) from r),
    'places', (select coalesce(jsonb_agg(distinct split_part(location, ' · ', 1)), '[]'::jsonb) from r where coalesce(location, '') <> ''),
    'gameIds', (select coalesce(jsonb_agg(distinct game_id), '[]'::jsonb) from r where game_id is not null))
  where (select public.stock_perm(p_owner, 'view'))
$$;
grant execute on function public.stock_counts(uuid) to authenticated;

-- Trh: kolik kusů které karty mám (karta → kusy).
create or replace function public.stock_have(p_owner uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.card_id, x.n), '{}'::jsonb) from (
    select l.card_id, sum(l.quantity + coalesce(s.keep_qty, 0) + coalesce(l.hidden_qty, 0))::int as n
      from public.listings l left join public.listing_stock s on s.listing_id = l.id
     where l.seller_id = p_owner and (select public.stock_perm(p_owner, 'view'))
     group by l.card_id having sum(l.quantity + coalesce(s.keep_qty, 0) + coalesce(l.hidden_qty, 0)) > 0) x
$$;
grant execute on function public.stock_have(uuid) to authenticated;

-- Trh › Vaše ceny: jen karty na prodej s cenou (stejný tvar řádku jako stock_rows).
create or replace function public.stock_sale_rows(p_owner uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(b.j order by b.ca desc, b.id), '[]'::jsonb)
    from public.stock_base(p_owner, array(
      select l.id from public.listings l
       where l.seller_id = p_owner and l.quantity > 0 and l.price_czk is not null and l.removed_at is null and l.hidden_qty is null), null, true) b
$$;
grant execute on function public.stock_sale_rows(uuid) to authenticated;
