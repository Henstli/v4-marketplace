-- Hledání v katalogu bere nabídky a vývoj ceny z předpočítané card_market (viz 20261104310000_card_market.sql).
-- Jen s filtrem nabídek (stav, jazyk, typ prodejce, prodejce, jen s nabídkou) se nabídky počítají živě jako dřív.
-- Výsledky, pořadí i počty zůstávají stejné.
CREATE OR REPLACE FUNCTION public.search_catalog(p_q text DEFAULT NULL::text, p_game text DEFAULT NULL::text, p_condition text DEFAULT NULL::text, p_language text DEFAULT NULL::text, p_seller_kind text DEFAULT NULL::text, p_sort text DEFAULT 'relevance'::text, p_only_offers boolean DEFAULT false, p_limit integer DEFAULT 48, p_offset integer DEFAULT 0, p_set uuid DEFAULT NULL::uuid, p_seller uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, slug text, name text, number text, rarity text, image_url text, game_id text, set_code text, set_name text, history integer[], min_price integer, offers integer, trend numeric, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
 SET statement_timeout TO '10s'
AS $function$
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
    -- Bez filtru: předpočítané (nejnižší cena a počet nabídek všech prodejců).
    select m.card_id, m.min_price, m.offers
    from public.card_market m
    where not v_listing_filter and m.offers > 0
    union all
    -- S filtrem nabídek: živě, jen odpovídající nabídky.
    select l.card_id, min(l.price_czk) as min_price, count(*)::int as offers
    from public.listings l
    join public.profiles p on p.id = l.seller_id
    where v_listing_filter
      and l.quantity > 0
      and (p_condition is null or l.condition::text = p_condition)
      and (p_language is null or l.language = p_language)
      and (p_seller_kind is null or p.kind::text = p_seller_kind)
      and (p_seller is null or l.seller_id = p_seller)
    group by l.card_id
  ),
  hist as (
    select m.card_id, m.history
    from public.card_market m
    where m.history is not null
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
$function$;

notify pgrst, 'reload schema';
