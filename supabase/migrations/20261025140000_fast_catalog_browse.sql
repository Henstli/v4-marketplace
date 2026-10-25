-- Rychlé procházení katalogu.
-- search_cards dosud při každém zobrazení katalogu seřadil všech ~120 tisíc karet (0,3–0,5 s, s odléváním na disk)
-- a jako SQL funkce dostávala obecný plán, takže ani hledání podle názvu nepoužilo fulltextový index.
-- Nově: hra a datum vydání sady se kopírují do karet, pořadí „bez nabídky“ drží index a funkce je v plpgsql
-- s vlastním plánem pro každé volání. Výsledky i pořadí zůstávají stejné.

alter table public.cards add column if not exists game_id text;
alter table public.cards add column if not exists released_on date;

update public.cards c
set game_id = s.game_id, released_on = s.released_on
from public.card_sets s
where s.id = c.set_id
  and (c.game_id is distinct from s.game_id or c.released_on is distinct from s.released_on);

-- Nová nebo přesunutá karta převezme hru a datum vydání ze své sady.
create or replace function public.cards_fill_set_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  select s.game_id, s.released_on into new.game_id, new.released_on
  from public.card_sets s where s.id = new.set_id;
  return new;
end;
$$;

create trigger cards_fill_set_fields
  before insert or update of set_id on public.cards
  for each row execute function public.cards_fill_set_fields();

-- Změna hry nebo data vydání sady se propíše do jejích karet.
create or replace function public.card_sets_sync_cards() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.game_id is distinct from old.game_id or new.released_on is distinct from old.released_on then
    update public.cards set game_id = new.game_id, released_on = new.released_on where set_id = new.id;
  end if;
  return null;
end;
$$;

create trigger card_sets_sync_cards
  after update on public.card_sets
  for each row execute function public.card_sets_sync_cards();

revoke execute on function public.cards_fill_set_fields() from public, anon, authenticated;
revoke execute on function public.card_sets_sync_cards() from public, anon, authenticated;

-- Pořadí karet bez nabídky (obrázek, novější sada, název) přímo v indexu, celkem i pro jednu hru.
create index if not exists cards_browse_idx
  on public.cards ((image_url is not null) desc, released_on desc nulls last, name, id) where not hidden;
create index if not exists cards_browse_game_idx
  on public.cards (game_id, (image_url is not null) desc, released_on desc nulls last, name, id) where not hidden;

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
language plpgsql stable security invoker
set search_path = ''
-- Plán pro konkrétní parametry: bez hledání odpadne filtr, s hledáním se použije fulltextový index.
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_tsq tsquery;
  v_listing_filter boolean := coalesce(p_only_offers, false) or p_condition is not null or p_language is not null or p_seller_kind is not null;
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
