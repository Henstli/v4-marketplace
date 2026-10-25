-- Import skutečných katalogů (Pokémon z TCGdex, Magic ze Scryfallu) a vyhledávání v SQL.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Sady, které importní funkce stahuje. Plní ji sama (režim discover), zapisuje jen service role.
create table public.catalog_sources (
  game_id text not null references public.games(id),
  source_set_id text not null,
  name text not null,
  released_on date,
  imported_at timestamptz,
  cards_imported int,
  last_error text,
  primary key (game_id, source_set_id)
);
alter table public.catalog_sources enable row level security;

create index cards_set_idx on public.cards (set_id);

-- Vyhledávání a filtry katalogu. Běží s právy volajícího, takže platí RLS.
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
  base as (
    select c.id, c.slug, c.name, c.number, c.rarity, c.image_url, s.game_id, s.code as set_code, s.name as set_name,
           s.released_on, o.min_price, coalesce(o.offers, 0) as offers
    from public.cards c
    join public.card_sets s on s.id = c.set_id
    left join offers o on o.card_id = c.id
    cross join q
    where (p_game is null or s.game_id = p_game)
      and (q.tsq is null or c.search @@ q.tsq)
      and (not (p_only_offers or p_condition is not null or p_language is not null or p_seller_kind is not null) or o.card_id is not null)
  ),
  enriched as (
    select b.*, h.history,
           case when array_length(h.history, 1) >= 2 and h.history[1] > 0
                then round(((h.history[array_length(h.history, 1)] - h.history[1])::numeric / h.history[1]) * 100, 1) end as trend
    from base b
    left join lateral (
      select array_agg(ph.avg_price_czk order by ph.day) as history
      from public.price_history ph
      where ph.card_id = b.id and ph.day >= current_date - 30
    ) h on true
  )
  select e.id, e.slug, e.name, e.number, e.rarity, e.image_url, e.game_id, e.set_code, e.set_name, e.history,
         e.min_price, e.offers, e.trend, count(*) over () as total_count
  from enriched e
  order by
    case when p_sort = 'price-asc' then e.min_price end asc nulls last,
    case when p_sort = 'price-desc' then e.min_price end desc nulls last,
    case when p_sort = 'trend' then e.trend end desc nulls last,
    (e.offers > 0) desc,
    e.released_on desc nulls last,
    e.name
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

grant execute on function public.search_cards(text, text, text, text, text, text, boolean, int, int) to anon, authenticated;

-- Heslo pro volání importní funkce je ve Vaultu (import_secret), funkce ho ověřuje touto RPC.
create or replace function public.check_import_secret(candidate text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'import_secret' and decrypted_secret = candidate)
$$;
revoke execute on function public.check_import_secret(text) from public, anon, authenticated;
grant execute on function public.check_import_secret(text) to service_role;

-- Importní funkce zapisuje jako service role; projekt nedává práva novým tabulkám automaticky.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
