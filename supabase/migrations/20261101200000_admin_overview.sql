-- Přehled webu pro správce: čísla za období a stav katalogu po hrách. Jen čtení (kromě
-- admin_catalog_retry, které jen znovu zařadí sady s chybou do importu). Vše jen pro správce.

create or replace function public.admin_site_overview(p_days int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d int := greatest(1, least(coalesce(p_days, 1), 366));
  t_now timestamptz := now();
  t_from timestamptz := now() - make_interval(days => d);
  t_prev timestamptz := now() - make_interval(days => 2 * d);
begin
  if not public.is_full_admin() then
    raise exception 'Jen pro správce' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles where created_at >= t_from),
    'users_prev', (select count(*) from public.profiles where created_at >= t_prev and created_at < t_from),
    'listings', (select count(*) from public.listings where created_at >= t_from),
    'listings_prev', (select count(*) from public.listings where created_at >= t_prev and created_at < t_from),
    'orders', (select count(*) from public.orders where created_at >= t_from),
    'orders_prev', (select count(*) from public.orders where created_at >= t_prev and created_at < t_from),
    'reports_open', (select count(*) from public.reports where status <> 'closed'),
    'cases_open', (select count(*) from public.support_cases where status = 'open'),
    'plus', (select count(*) from public.subscriptions where plan = 'plus'),
    'pro', (select count(*) from public.subscriptions where plan = 'pro'),
    'users_total', (select count(*) from public.profiles),
    'listings_active', (select count(*) from public.listings where quantity > 0 and removed_at is null),
    'at', t_now
  );
end;
$$;

-- Počet karet bere ze zdrojů (rychlé), bez obrázku přes malý částečný index.
create index if not exists cards_no_image_idx on public.cards (game_id) where image_url is null and not hidden;

create or replace function public.admin_catalog_status()
returns table (game_id text, sets int, checked_24h int, errors int, last_check timestamptz, last_error text, cards int, no_image int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_full_admin() then
    raise exception 'Jen pro správce' using errcode = '42501';
  end if;
  return query
  with s as (
    select cs.game_id,
      count(*)::int sets,
      (count(*) filter (where cs.imported_at >= now() - interval '24 hours'))::int checked_24h,
      (count(*) filter (where cs.last_error is not null))::int errors,
      max(cs.imported_at) last_check,
      (array_agg(cs.last_error order by cs.imported_at desc) filter (where cs.last_error is not null))[1] last_error,
      coalesce(sum(cs.cards_imported), 0)::int cards
    from public.catalog_sources cs group by cs.game_id
  ), c as (
    select k.game_id, count(*)::int no_image
    from public.cards k where k.image_url is null and not k.hidden group by k.game_id
  )
  select s.game_id, s.sets, s.checked_24h, s.errors, s.last_check, s.last_error, s.cards, coalesce(c.no_image, 0)
  from s left join c on c.game_id = s.game_id;
end;
$$;

-- Znovu stáhne sady hry, které skončily chybou (nejvýš 10 naráz, každá zvlášť přes import-catalog).
create or replace function public.admin_catalog_retry(p_game text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  if not public.is_full_admin() then
    raise exception 'Jen pro správce' using errcode = '42501';
  end if;
  for r in
    select source_set_id from public.catalog_sources
    where game_id = p_game and last_error is not null
    order by imported_at nulls first limit 10
  loop
    perform public.call_import_catalog(jsonb_build_object('mode', 'set', 'game', p_game, 'id', r.source_set_id));
    n := n + 1;
  end loop;
  return n;
end;
$$;

grant execute on function public.admin_site_overview(int) to authenticated;
grant execute on function public.admin_catalog_status() to authenticated;
grant execute on function public.admin_catalog_retry(text) to authenticated;
