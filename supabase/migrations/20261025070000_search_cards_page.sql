-- search_cards: řazení a stránkování nad úzkými řádky, detaily karet se dočtou jen pro vybranou stránku.
create or replace function public.search_cards(
  p_q text default null,
  p_game text default null,
  p_condition text default null,
  p_language text default null,
  p_seller_kind text default null,
  p_sort text default 'relevance',
  p_only_offers boolean default false,
  p_limit int default 48,
  p_offset int default 0
) returns table (
  id uuid, slug text, name text, number text, rarity text, image_url text,
  game_id text, set_code text, set_name text, history int[],
  min_price int, offers int, trend numeric, total_count bigint
)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select case when coalesce(trim(p_q), '') = '' then null else (
      select to_tsquery('simple', string_agg(w || ':*', ' & '))
      from regexp_split_to_table(lower(public.unaccent_immutable(p_q)), '[^a-z0-9]+') w
      where w <> ''
    ) end as tsq
  ),
  offers as (
    select l.card_id, min(l.price_czk) as min_price, count(*)::int as offers
    from public.listings l
    join public.profiles p on p.id = l.seller_id
    where l.quantity > 0
      and (p_condition is null or l.condition::text = p_condition)
      and (p_language is null or l.language = p_language)
      and (p_seller_kind is null or p.kind::text = p_seller_kind)
    group by l.card_id
  ),
  -- Historie cen jen pro karty, které nějakou mají (malá tabulka), ne dotazem pro každou kartu katalogu.
  hist as (
    select ph.card_id, array_agg(ph.avg_price_czk order by ph.day) as history
    from public.price_history ph
    where ph.day >= current_date - 30
    group by ph.card_id
  ),
  -- Řazení a stránkování jen nad úzkými řádky; detaily karet se dočtou až pro vybranou stránku.
  ranked as (
    select c.id, c.name, s.released_on, o.min_price, coalesce(o.offers, 0) as offers, h.history,
           case when array_length(h.history, 1) >= 2 and h.history[1] > 0
                then round(((h.history[array_length(h.history, 1)] - h.history[1])::numeric / h.history[1]) * 100, 1) end as trend
    from public.cards c
    join public.card_sets s on s.id = c.set_id
    left join offers o on o.card_id = c.id
    left join hist h on h.card_id = c.id
    cross join q
    where (p_game is null or s.game_id = p_game)
      and (q.tsq is null or c.search @@ q.tsq)
      and (not (p_only_offers or p_condition is not null or p_language is not null or p_seller_kind is not null) or o.card_id is not null)
  ),
  page as (
    select r.*, count(*) over () as total_count
    from ranked r
    order by
      case when p_sort = 'price-asc' then r.min_price end asc nulls last,
      case when p_sort = 'price-desc' then r.min_price end desc nulls last,
      case when p_sort = 'trend' then r.trend end desc nulls last,
      (r.offers > 0) desc,
      r.released_on desc nulls last,
      r.name
    limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
  ),
  numbered as (
    select p.*, row_number() over () as pos from page p
  )
  select c.id, c.slug, c.name, c.number, c.rarity, c.image_url, s.game_id, s.code, s.name, n.history,
         n.min_price, n.offers, n.trend, n.total_count
  from numbered n
  join public.cards c on c.id = n.id
  join public.card_sets s on s.id = c.set_id
  order by n.pos;
$$;
