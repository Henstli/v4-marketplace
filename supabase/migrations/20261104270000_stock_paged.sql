-- Sklad po stránkách: hledání, filtry, řazení a souhrny počítá databáze, do prohlížeče jde jen zobrazená stránka.
-- Práva stejná jako stock_load a RLS: majitel nebo člen týmu s právem 'view' (stock_perm), jinak nic.

-- Řádky skladu s dopočtenými údaji (stejná pravidla jako dřív v prohlížeči, StockTable.tsx).
create or replace function public.stock_items(p_owner uuid)
  returns table (
    id uuid, card_id uuid, name text, srch text, game text, cond text, lang text,
    have int, sale int, trade int, price int, market int, loc text, src text, listed int,
    locked boolean, upd timestamptz, ca timestamptz, j jsonb
  )
  language sql stable security definer set search_path = '' as $$
  with b as (
    select l.id, l.card_id, l.price_czk, l.condition::text as cond, l.language as lang, l.quantity, l.hidden_qty, l.removed_at, l.created_at,
           s.keep_qty, s.trade_qty, s.location, s.buy_price_czk, s.listed_at, s.source, s.updated_at,
           c.id as cid, c.slug, c.name as cname, c.number, c.image_url, c.game_id, cs.code, cs.name as setname,
           coalesce(
             (select ph.avg_price_czk from public.price_history ph where ph.card_id = l.card_id order by ph.day desc limit 1),
             (select min(m.price_czk) from public.listings m
               where m.card_id = l.card_id and m.quantity > 0 and m.price_czk is not null and m.hidden_qty is null and m.removed_at is null)
           ) as market
      from public.listings l
      left join public.listing_stock s on s.listing_id = l.id
      left join public.cards c on c.id = l.card_id and not c.hidden
      left join public.card_sets cs on cs.id = c.set_id
     where l.seller_id = p_owner and public.stock_perm(p_owner, 'view')
  ), x as (
    select b.*, (b.quantity + coalesce(b.keep_qty, 0) + coalesce(b.hidden_qty, 0)) as have_,
           (b.removed_at is not null or b.hidden_qty is not null) as locked_,
           trim(coalesce(b.code, '') || ' ' || coalesce(b.number, '')) as setstr
      from b
  )
  select x.id, x.card_id, coalesce(x.cname, 'Karta'),
         lower(public.unaccent_immutable(coalesce(x.cname, 'Karta') || ' ' || x.setstr || ' ' || coalesce(x.location, ''))),
         coalesce(x.game_id, ''), x.cond, x.lang,
         x.have_, x.quantity, least(coalesce(x.trade_qty, 0), x.have_), x.price_czk, x.market, coalesce(x.location, ''), coalesce(x.source, 'manual'),
         case when x.quantity > 0 and x.listed_at is not null then floor(extract(epoch from (now() - x.listed_at)) / 86400)::int else 0 end,
         x.locked_, coalesce(x.updated_at, x.created_at), x.created_at,
         jsonb_build_object('id', x.id, 'cid', x.card_id, 'p', x.price_czk, 'co', x.cond, 'la', x.lang, 'q', x.quantity, 'h', x.hidden_qty,
           'rm', x.removed_at is not null, 'ca', x.created_at, 'k', x.keep_qty, 't', x.trade_qty, 'lo', x.location, 'b', x.buy_price_czk,
           'li', x.listed_at, 'so', x.source, 'u', x.updated_at, 'm', x.market,
           'c', case when x.cid is not null then jsonb_build_object('slug', x.slug, 'name', x.cname, 'number', x.number, 'image', x.image_url,
             'game', x.game_id, 'code', x.code, 'set', x.setname) end)
    from x
   where x.have_ > 0 or x.locked_
$$;

-- Upozornění u obchodu (stejně jako issues() v prohlížeči): bez ceny, 15 % mimo trh, bez umístění, leží 60+ dní.
create or replace function public.stock_issue(p_sale int, p_price int, p_market int, p_loc text, p_listed int)
  returns boolean language sql immutable set search_path = '' as $$
  select (p_sale > 0 and p_price is null)
      or (p_price is not null and coalesce(p_market, 0) <> 0 and abs(p_price::numeric / p_market - 1) >= 0.15)
      or p_loc = ''
      or (p_sale > 0 and p_listed >= 60)
$$;

-- Řádky podle filtru v pořadí tabulky (p: mode, shop, q, g[], c[], l[], s[], p[] místa ('—' = bez umístění),
-- forSale 'on'|'off'|'', attn, dup, old, sort 'chg'|'name'|'have'|'price').
create or replace function public.stock_visible(p_owner uuid, p jsonb)
  returns table (pos int, id uuid, card_id uuid, cond text, lang text, locked boolean, j jsonb)
  language sql stable security definer set search_path = '' as $$
  with f as (
    select coalesce(p->>'mode', 'all') = 'sale' as sale_,
           coalesce((p->>'shop')::boolean, false) as shop_,
           nullif(lower(public.unaccent_immutable(trim(coalesce(p->>'q', '')))), '') as q_,
           array(select jsonb_array_elements_text(coalesce(p->'g', '[]'))) as g_,
           array(select jsonb_array_elements_text(coalesce(p->'c', '[]'))) as c_,
           array(select jsonb_array_elements_text(coalesce(p->'l', '[]'))) as l_,
           array(select jsonb_array_elements_text(coalesce(p->'s', '[]'))) as s_,
           array(select jsonb_array_elements_text(coalesce(p->'p', '[]'))) as p_,
           coalesce(p->>'forSale', '') as fs_,
           coalesce((p->>'attn')::boolean, false) as attn_,
           coalesce((p->>'dup')::boolean, false) as dup_,
           coalesce((p->>'old')::boolean, false) as old_,
           coalesce(p->>'sort', 'chg') as sort_
  )
  select row_number() over (order by
           case when f.sort_ = 'chg' then i.upd end desc,
           case when f.sort_ = 'name' then i.name end collate "cs-x-icu" asc,
           case when f.sort_ = 'have' then i.have end desc,
           case when f.sort_ = 'price' then coalesce(i.price, i.market, 0) end desc,
           i.ca desc, i.id)::int,
         i.id, i.card_id, i.cond, i.lang, i.locked, i.j
    from public.stock_items(p_owner) i, f
   where (not f.sale_ or i.sale > 0)
     and (cardinality(f.g_) = 0 or i.game = any(f.g_))
     and (cardinality(f.c_) = 0 or i.cond = any(f.c_))
     and (cardinality(f.l_) = 0 or i.lang = any(f.l_))
     and (cardinality(f.s_) = 0 or i.src = any(f.s_))
     and (cardinality(f.p_) = 0 or exists (select 1 from unnest(f.p_) pl
           where (pl = '—' and i.loc = '') or (pl <> '—' and i.loc <> '' and (i.loc = pl or left(i.loc, length(pl) + 3) = pl || ' · '))))
     and (not f.attn_ or (f.shop_ and public.stock_issue(i.sale, i.price, i.market, i.loc, i.listed)))
     and (not f.dup_ or i.have > 1)
     and (not f.old_ or (i.sale > 0 and i.listed >= 60))
     and (f.fs_ <> 'on' or i.sale > 0)
     and (f.fs_ <> 'off' or i.sale = 0)
     and (f.q_ is null or position(f.q_ in i.srch) > 0)
$$;

-- Jedna stránka tabulky: skupiny karet (varianty pod sebou), počty pro patičku a výběr.
-- p navíc: page, size (karet na stránku), more (kolikrát „Zobrazit dalších“), what 'page'|'full'|'ids'.
create or replace function public.stock_query(p_owner uuid, p jsonb)
  returns jsonb language sql stable security definer set search_path = '' as $$
  with v as materialized (select * from public.stock_visible(p_owner, p)),
  o as (
    select least(greatest(coalesce((p->>'size')::int, 10), 1), 100) as size_,
           least(greatest(coalesce((p->>'more')::int, 0), 0), 50) as more_,
           greatest(coalesce((p->>'page')::int, 1), 1) as page_,
           coalesce(p->>'what', 'page') as what_
  ),
  gn as (
    select g.card_id, row_number() over (order by g.gpos)::int as n
      from (select v.card_id, min(v.pos) as gpos from v group by v.card_id) g
  ),
  pg as (
    select greatest(1, least(o.page_, ceil((select count(*) from gn)::numeric / o.size_)::int)) as page_, o.size_, o.more_, o.what_ from o
  )
  select case
    when pg.what_ = 'ids' then jsonb_build_object('ids', (select coalesce(jsonb_agg(v.id order by v.pos), '[]'::jsonb) from v where not v.locked))
    when pg.what_ = 'full' then jsonb_build_object('rows', (select coalesce(jsonb_agg(v.j order by v.pos), '[]'::jsonb) from v where not v.locked))
    else jsonb_build_object(
      'page', pg.page_,
      'nGroups', (select count(*) from gn),
      'nRows', (select count(*) from v),
      'nIds', (select count(*) from v where not v.locked),
      'rows', (select coalesce(jsonb_agg(v.j order by gn.n,
                 case v.cond when 'MT' then 0 when 'NM' then 1 when 'EX' then 2 when 'GD' then 3 when 'LP' then 4 when 'PL' then 5 else 6 end,
                 v.lang, v.pos), '[]'::jsonb)
                 from v join gn on gn.card_id = v.card_id
                where gn.n > (pg.page_ - 1) * pg.size_ and gn.n <= (pg.page_ - 1) * pg.size_ + pg.size_ * (pg.more_ + 1)))
    end
    from pg
   where public.stock_perm(p_owner, 'view')
$$;
grant execute on function public.stock_query(uuid, jsonb) to authenticated;

-- Konkrétní řádky (po úpravě se v tabulce obnoví jen ony; nebo detail karty z pruhu podle karty).
create or replace function public.stock_rows(p_owner uuid, p_ids uuid[], p_card uuid default null)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(i.j order by i.ca desc, i.id), '[]'::jsonb)
    from public.stock_items(p_owner) i
   where i.id = any(p_ids[1:5000]) or i.card_id = p_card
$$;
grant execute on function public.stock_rows(uuid, uuid[], uuid) to authenticated;

-- Souhrny: pruh nad tabulkou, upozornění, nabídky filtrů, počty v záložkách.
create or replace function public.stock_summary(p_owner uuid, p_mode text default 'all', p_shop boolean default false)
  returns jsonb language sql stable security definer set search_path = '' as $$
  with a as (select * from public.stock_items(p_owner)),
  b as (select * from a where p_mode <> 'sale' or a.sale > 0),
  dups as (select a.card_id from a group by a.card_id having sum(a.have) > 1),
  lg as (select case when b.loc = '' then '—' else split_part(b.loc, ' · ', 1) end as k, sum(b.have)::int as n from b group by 1),
  lf as (select b.loc as k, sum(b.have)::int as n from b where b.loc <> '' group by 1),
  -- Počty pro záložky a menu vychází ze všech řádků s kusy (jako dřív owned > 0).
  allrows as (
    select l.card_id, l.quantity, (l.quantity + coalesce(s.keep_qty, 0) + coalesce(l.hidden_qty, 0)) as own, s.location, c.game_id
      from public.listings l
      left join public.listing_stock s on s.listing_id = l.id
      left join public.cards c on c.id = l.card_id and not c.hidden
     where l.seller_id = p_owner and public.stock_perm(p_owner, 'view')
  )
  select jsonb_build_object(
    'total', (select count(*) from a),
    'pcs', (select coalesce(sum(have), 0) from a),
    'kinds', (select count(distinct card_id) from a),
    'onSale', (select coalesce(sum(sale), 0) from a),
    'val', (select coalesce(sum(have::numeric * coalesce(market, price, 0)), 0) from a),
    'offer', (select coalesce(sum(sale::numeric * coalesce(price, market, 0)), 0) from a),
    'oldN', (select count(*) from a where sale > 0 and listed >= 60),
    'dups', (select count(*) from dups),
    'tradeN', (select count(*) from a where trade > 0),
    'attn', case when p_shop then jsonb_build_object(
      'n', (select count(*) from a where public.stock_issue(sale, price, market, loc, listed)),
      'noPrice', (select count(*) from a where sale > 0 and price is null),
      'mkt', (select count(*) from a where price is not null and coalesce(market, 0) <> 0 and abs(price::numeric / market - 1) >= 0.15),
      'noLoc', (select count(*) from a where loc = ''),
      'old', (select count(*) from a where sale > 0 and listed >= 60)) end,
    'games', (select coalesce(jsonb_agg(distinct b.game), '[]'::jsonb) from b),
    'langs', (select coalesce(jsonb_agg(distinct b.lang), '[]'::jsonb) from b),
    'srcs', (select coalesce(jsonb_agg(x.src order by x.f desc), '[]'::jsonb) from (select b.src, max(b.ca) as f from b group by b.src) x),
    'locg', (select coalesce(jsonb_object_agg(lg.k, lg.n), '{}'::jsonb) from lg),
    'locf', (select coalesce(jsonb_object_agg(lf.k, lf.n), '{}'::jsonb) from lf),
    'kindsAll', (select count(distinct card_id) from allrows where own > 0),
    'kindsSale', (select count(distinct card_id) from allrows where own > 0 and quantity > 0),
    'owned', (select count(*) from allrows where own > 0),
    'rows', (select count(*) from allrows),
    'places', (select coalesce(jsonb_agg(distinct split_part(location, ' · ', 1)), '[]'::jsonb) from allrows where coalesce(location, '') <> ''),
    'gameIds', (select coalesce(jsonb_agg(distinct game_id), '[]'::jsonb) from allrows where game_id is not null)
  )
  where public.stock_perm(p_owner, 'view')
$$;
grant execute on function public.stock_summary(uuid, text, boolean) to authenticated;
