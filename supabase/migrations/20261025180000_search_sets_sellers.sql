-- Hledání podle sad a prodejců.
-- search_catalog je search_cards (security definer, stejné pořadí a stránkování) se dvěma filtry navíc:
-- sada (katalog jen s kartami jedné sady) a prodejce (jeho stránka s nabídkami). search_cards zůstává beze změny.
-- suggest_groups doplňuje našeptávač o sady (název nebo kód) a prodejce, kteří něco prodávají.

create or replace function public.search_catalog(
  p_q text default null,
  p_game text default null,
  p_condition text default null,
  p_language text default null,
  p_seller_kind text default null,
  p_sort text default 'relevance',
  p_only_offers boolean default false,
  p_limit int default 48,
  p_offset int default 0,
  p_set uuid default null,
  p_seller uuid default null
) returns table (
  id uuid, slug text, name text, number text, rarity text, image_url text,
  game_id text, set_code text, set_name text, history int[],
  min_price int, offers int, trend numeric, total_count bigint
)
language plpgsql stable security definer
set search_path = ''
-- Plán pro konkrétní parametry: bez hledání odpadne filtr, s hledáním se použije fulltextový index.
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_tsq tsquery;
  -- Stránka prodejce ukazuje jen karty, které prodává.
  v_listing_filter boolean := coalesce(p_only_offers, false) or p_condition is not null or p_language is not null
    or p_seller_kind is not null or p_seller is not null;
  v_limit int := least(greatest(coalesce(p_limit, 48), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
begin
  if coalesce(trim(p_q), '') <> '' then
    select to_tsquery('simple', string_agg(w || ':*', ' & ')) into v_tsq
    from regexp_split_to_table(lower(public.unaccent_immutable(p_q)), '[^a-z0-9]+') w
    where w <> '';
  end if;

  -- Bez filtru nabídek je celkem počet odpovídajících karet (počítá se z indexu).
  if not v_listing_filter then
    select count(*) into v_total
    from public.cards c
    where not c.hidden
      and (p_game is null or c.game_id = p_game)
      and (p_set is null or c.set_id = p_set)
      and (v_tsq is null or c.search @@ v_tsq);
  end if;

  return query
  with offers as (
    select l.card_id, min(l.price_czk) as min_price, count(*)::int as offers
    from public.listings l
    join public.profiles p on p.id = l.seller_id
    where l.quantity > 0
      and (p_condition is null or l.condition::text = p_condition)
      and (p_language is null or l.language = p_language)
      and (p_seller_kind is null or p.kind::text = p_seller_kind)
      and (p_seller is null or l.seller_id = p_seller)
    group by l.card_id
  ),
  hist as (
    select ph.card_id, array_agg(ph.avg_price_czk order by ph.day) as history
    from public.price_history ph
    where ph.day >= current_date - 30
    group by ph.card_id
  ),
  -- Nabídky a vývoj ceny mají jen karty, se kterými se obchoduje (malá množina).
  stats as (
    select coalesce(o.card_id, h.card_id) as card_id, o.min_price, coalesce(o.offers, 0) as offers, h.history,
           case when array_length(h.history, 1) >= 2 and h.history[1] > 0
                then round(((h.history[array_length(h.history, 1)] - h.history[1])::numeric / h.history[1]) * 100, 1) end as trend
    from offers o
    full join hist h on h.card_id = o.card_id
  ),
  -- Karty, které se řadí před všechny ostatní: s nabídkou, u řazení podle růstu i s vypočteným růstem.
  head as (
    select c.id, st.min_price, st.offers, st.trend, (c.image_url is not null) as has_image, c.released_on, c.name
    from stats st
    join public.cards c on c.id = st.card_id
    where not c.hidden
      and (p_game is null or c.game_id = p_game)
      and (p_set is null or c.set_id = p_set)
      and (v_tsq is null or c.search @@ v_tsq)
      and (st.offers > 0 or (p_sort = 'trend' and st.trend is not null))
      and (not v_listing_filter or st.offers > 0)
  ),
  -- Ostatní karty už jen v pořadí indexu (obrázek, novější sada, název) a jen tolik, kolik stránka potřebuje.
  tail as (
    select c.id, (c.image_url is not null) as has_image, c.released_on, c.name
    from public.cards c
    where not v_listing_filter
      and not c.hidden
      and (p_game is null or c.game_id = p_game)
      and (p_set is null or c.set_id = p_set)
      and (v_tsq is null or c.search @@ v_tsq)
      and not exists (select 1 from head where head.id = c.id)
    order by (c.image_url is not null) desc, c.released_on desc nulls last, c.name, c.id
    limit v_offset + v_limit
  ),
  ordered as (
    select head.id, 0 as grp, row_number() over (order by
      case when p_sort = 'price-asc' then head.min_price end asc nulls last,
      case when p_sort = 'price-desc' then head.min_price end desc nulls last,
      case when p_sort = 'trend' then head.trend end desc nulls last,
      (head.offers > 0) desc,
      head.has_image desc,
      head.released_on desc nulls last,
      head.name,
      head.id) as rn
    from head
    union all
    select tail.id, 1, row_number() over (order by tail.has_image desc, tail.released_on desc nulls last, tail.name, tail.id)
    from tail
  ),
  page as (
    select o.id, row_number() over (order by o.grp, o.rn) as pos
    from (select * from ordered order by grp, rn limit v_limit offset v_offset) o
  )
  select c.id, c.slug, c.name, c.number, c.rarity, c.image_url, s.game_id, s.code, s.name, st.history,
         st.min_price, coalesce(st.offers, 0), st.trend,
         coalesce(v_total, (select count(*) from head))
  from page pg
  join public.cards c on c.id = pg.id
  join public.card_sets s on s.id = c.set_id
  left join stats st on st.card_id = c.id
  order by pg.pos;
end;
$$;

grant execute on function public.search_catalog(text, text, text, text, text, text, boolean, int, int, uuid, uuid) to anon, authenticated;

create or replace function public.suggest_groups(p_q text, p_game text default null)
returns table (
  kind text, ref text, name text, game_id text, code text, released_on date, items int,
  seller_kind text, country text, positive int
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_norm text := trim(regexp_replace(lower(public.unaccent_immutable(coalesce(p_q, ''))), '[^a-z0-9]+', ' ', 'g'));
  v_tsq tsquery;
begin
  if length(v_norm) < 2 then
    return;
  end if;
  select to_tsquery('simple', string_agg(w || ':*', ' & ')) into v_tsq
  from regexp_split_to_table(v_norm, ' ') w
  where w <> '';

  -- Sady: název nebo kód (OBF, MH3). Sad je pár stovek, index nepotřebují.
  return query
  select 'set', s.id::text, s.name, s.game_id, s.code, s.released_on,
         (select count(*)::int from public.cards c where c.set_id = s.id and not c.hidden),
         null::text, null::text, null::int
  from public.card_sets s
  where (p_game is null or s.game_id = p_game)
    and to_tsvector('simple', regexp_replace(lower(public.unaccent_immutable(s.name || ' ' || s.code)), '[^a-z0-9]+', ' ', 'g')) @@ v_tsq
    and exists (select 1 from public.cards c where c.set_id = s.id and not c.hidden)
  order by (lower(s.code) = v_norm) desc,
           (regexp_replace(lower(public.unaccent_immutable(s.name)), '[^a-z0-9]+', ' ', 'g') like v_norm || '%') desc,
           s.released_on desc nulls last, s.name
  limit 3;

  -- Prodejci, kteří mají něco v nabídce. Kladná hodnocení = 4 a 5 hvězdiček.
  return query
  select 'seller', p.id::text, p.display_name, null::text, null::text, null::date,
         (select count(*)::int from public.listings l where l.seller_id = p.id and l.quantity > 0),
         p.kind::text, p.country,
         (select round(100.0 * count(*) filter (where r.rating >= 4) / nullif(count(*), 0))::int
          from public.reviews r where r.seller_id = p.id)
  from public.profiles p
  where to_tsvector('simple', regexp_replace(lower(public.unaccent_immutable(p.display_name)), '[^a-z0-9]+', ' ', 'g')) @@ v_tsq
    and exists (select 1 from public.listings l where l.seller_id = p.id and l.quantity > 0)
  order by (regexp_replace(lower(public.unaccent_immutable(p.display_name)), '[^a-z0-9]+', ' ', 'g') like v_norm || '%') desc,
           (p.kind = 'shop') desc, p.display_name
  limit 3;
end;
$$;

revoke execute on function public.suggest_groups(text, text) from public;
grant execute on function public.suggest_groups(text, text) to anon, authenticated;
