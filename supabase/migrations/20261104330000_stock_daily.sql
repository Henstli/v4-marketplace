-- Okna z pruhu skladu a sbírky (podle prototypu): Podrobnosti ke kusům, druhům a kartám na prodej
-- a Hodnota v čase. Vývoj se počítá z nočních záznamů stock_daily (od 4. 11. 2026, starší data nejsou).

-- Jeden řádek na majitele a den. val = dnešní kusy × dnešní tržní cena, val_prev = dnešní kusy × včerejší tržní cena,
-- takže změna počtu kusů (prodej, naskladnění) se do vývoje hodnoty nepočítá jako růst ani pokles.
-- off / off_prev totéž pro nabídku (kusy na prodej × vlastní cena dnes / včera).
create table if not exists public.stock_daily (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  pcs integer not null default 0,
  kinds integer not null default 0,
  sale integer not null default 0,
  val bigint not null default 0,
  val_prev bigint not null default 0,
  off bigint not null default 0,
  off_prev bigint not null default 0,
  primary key (owner_id, day)
);
-- Čte se jen přes funkce níže (s kontrolou stock_perm), přímý přístup nikdo nemá.
alter table public.stock_daily enable row level security;

-- Včerejší prodejní ceny nabídek (pro off_prev).
create table if not exists public.listing_price_last (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  price integer not null
);
alter table public.listing_price_last enable row level security;

create or replace function public.stock_daily_run()
  returns void language plpgsql security definer set search_path = '' as $$
begin
  with r as (
    select l.seller_id as o, l.card_id, l.quantity as q, l.price_czk as p, lp.price as p_prev,
           (l.quantity + coalesce(s.keep_qty, 0) + coalesce(l.hidden_qty, 0)) as have,
           (select ph.avg_price_czk from public.price_history ph where ph.card_id = l.card_id order by ph.day desc limit 1) as m_now,
           (select ph.avg_price_czk from public.price_history ph where ph.card_id = l.card_id and ph.day < current_date order by ph.day desc limit 1) as m_prev,
           (select min(m.price_czk) from public.listings m
             where m.card_id = l.card_id and m.quantity > 0 and m.price_czk is not null and m.hidden_qty is null and m.removed_at is null) as m_low
      from public.listings l
      left join public.listing_stock s on s.listing_id = l.id
      left join public.listing_price_last lp on lp.listing_id = l.id
     where (l.quantity + coalesce(s.keep_qty, 0) + coalesce(l.hidden_qty, 0)) > 0 or l.removed_at is not null or l.hidden_qty is not null
  ), v as (
    select r.*, coalesce(r.m_now, r.m_low) as mk, coalesce(r.m_prev, r.m_now, r.m_low) as mkp from r
  )
  insert into public.stock_daily as d (owner_id, day, pcs, kinds, sale, val, val_prev, off, off_prev)
  select v.o, current_date, sum(v.have), count(distinct v.card_id), sum(v.q),
         sum(v.have::bigint * coalesce(v.mk, v.p, 0)), sum(v.have::bigint * coalesce(v.mkp, v.p, 0)),
         sum(v.q::bigint * coalesce(v.p, v.mk, 0)), sum(v.q::bigint * coalesce(v.p_prev, v.p, v.mkp, 0))
    from v
   where exists (select 1 from public.profiles p where p.id = v.o)
   group by v.o
  on conflict (owner_id, day) do update set pcs = excluded.pcs, kinds = excluded.kinds, sale = excluded.sale,
    val = excluded.val, val_prev = excluded.val_prev, off = excluded.off, off_prev = excluded.off_prev;

  -- Dnešní ceny si zapamatujeme na zítřek.
  insert into public.listing_price_last as x (listing_id, price)
  select l.id, l.price_czk from public.listings l where l.price_czk is not null
  on conflict (listing_id) do update set price = excluded.price where x.price is distinct from excluded.price;
end $$;
revoke execute on function public.stock_daily_run() from public, anon, authenticated;

-- Každou noc po zápisu tržních cen (price_snapshot běží ve 2:00 UTC).
select cron.unschedule('stock-daily') where exists (select 1 from cron.job where jobname = 'stock-daily');
select cron.schedule('stock-daily', '30 3 * * *', 'select public.stock_daily_run()');

-- Hodnota v čase: body grafu (od nejstaršího dne) a karty, které hodnotu nejvíc táhnou nahoru a dolů.
-- p_off = hodnota nabídky (záložka Na prodej), jinak hodnota podle trhu. Dnešní bod = dnešní hodnota.
create or replace function public.stock_value_detail(p_owner uuid, p_off boolean, p_days integer)
  returns jsonb language sql stable security definer set search_path = '' as $$
  with ok as (select (select public.stock_perm(p_owner, 'view')) as ok),
  a as (select * from public.stock_base(p_owner, null, null, false) where (select ok from ok)),
  now_ as (select case when p_off then coalesce(sum(a.sale::numeric * coalesce(a.price, a.market, 0)), 0)
                       else coalesce(sum(a.have::numeric * coalesce(a.market, a.price, 0)), 0) end as v from a),
  d as (
    select sd.day, case when p_off then sd.off else sd.val end as v, case when p_off then sd.off_prev else sd.val_prev end as vp
      from public.stock_daily sd
     where sd.owner_id = p_owner and sd.day > current_date - least(greatest(p_days, 7), 366) and (select ok from ok)
  ),
  -- Hodnota na konci dne j = dnešní hodnota × součin denních změn po dni j (změna kusů se nepočítá).
  pts as (
    select d.day, (select v from now_) * exp(coalesce(sum(ln(case when d.v > 0 and d.vp > 0 then d.vp::numeric / d.v else 1 end))
             over (order by d.day desc rows between unbounded preceding and 1 preceding), 0)) as v
      from d
  ),
  -- Tržní cena karty na začátku a na konci období (z denních tržních cen).
  q as (
    select a.card_id, sum(case when p_off then a.sale else a.have end)::int as n, max(a.name) as name
      from a group by a.card_id having sum(case when p_off then a.sale else a.have end) > 0
  ),
  mv as (
    select q.card_id, q.n, q.name,
           (select ph.avg_price_czk from public.price_history ph where ph.card_id = q.card_id and ph.day >= current_date - p_days order by ph.day limit 1) as f,
           (select ph.avg_price_czk from public.price_history ph where ph.card_id = q.card_id and ph.day >= current_date - p_days order by ph.day desc limit 1) as t,
           (select count(*) from public.price_history ph where ph.card_id = q.card_id and ph.day >= current_date - p_days) as k
      from q
  ),
  mc as (
    select mv.card_id, mv.n, mv.name, (mv.n * (mv.t - mv.f))::bigint as c, c.image_url, cs.code, c.number
      from mv join public.cards c on c.id = mv.card_id left join public.card_sets cs on cs.id = c.set_id
     where mv.k > 1 and mv.t <> mv.f
  )
  select jsonb_build_object(
    'now', (select round(v) from now_),
    'pts', (select coalesce(jsonb_agg(jsonb_build_array(z.day, round(z.v)) order by z.day), '[]'::jsonb) from (
      select pts.day, pts.v from pts
      union all
      select current_date, (select v from now_) where not exists (select 1 from d where d.day = current_date)) z),
    'up', (select coalesce(jsonb_agg(x order by x.c desc), '[]'::jsonb) from (
      select mc.card_id as id, mc.name, mc.code, mc.number, mc.image_url as img, mc.n, mc.c from mc where mc.c > 0 order by mc.c desc limit 4) x),
    'down', (select coalesce(jsonb_agg(x order by x.c), '[]'::jsonb) from (
      select mc.card_id as id, mc.name, mc.code, mc.number, mc.image_url as img, mc.n, mc.c from mc where mc.c < 0 order by mc.c limit 4) x))
  where (select ok from ok)
$$;
grant execute on function public.stock_value_detail(uuid, boolean, integer) to authenticated;

-- Podrobnosti k dlaždicím Kusů celkem (k = 0), Druhů (1) a Na prodej (2): vývoj počtu a rozpady.
create or replace function public.stock_detail(p_owner uuid, p_k integer, p_days integer)
  returns jsonb language sql stable security definer set search_path = '' as $$
  with ok as (select (select public.stock_perm(p_owner, 'view')) as ok),
  a as (select * from public.stock_base(p_owner, null, null, false) where (select ok from ok)),
  cur as (select coalesce(sum(a.have), 0)::int as pcs, count(distinct a.card_id)::int as kinds, coalesce(sum(a.sale), 0)::int as sale from a),
  ser as (
    select sd.day, case p_k when 0 then sd.pcs when 1 then sd.kinds else sd.sale end as n
      from public.stock_daily sd
     where sd.owner_id = p_owner and sd.day > current_date - least(greatest(p_days, 7), 366) and sd.day < current_date and (select ok from ok)
    union all
    select current_date, case p_k when 0 then cur.pcs when 1 then cur.kinds else cur.sale end from cur
  ),
  st as (
    select a.*, c.set_id, cs.code, cs.name as setname, c.number
      from a left join public.cards c on c.id = a.card_id left join public.card_sets cs on cs.id = c.set_id
  ),
  kc as (select st.card_id, max(st.name) as name, max(st.code) as code, max(st.number) as number, sum(st.have)::int as n from st group by st.card_id having sum(st.have) > 0),
  -- Kusy v otevřených objednávkách (rezervované, ještě neprodané).
  res as (
    select coalesce(sum(oi.quantity), 0)::int as n
      from public.order_items oi join public.orders o on o.id = oi.order_id
     where o.seller_id = p_owner and o.status::text in ('requested', 'confirmed', 'pending_payment', 'paid') and (select ok from ok)
  ),
  sold as (
    select coalesce(sum(oi.quantity), 0)::int as n
      from public.order_items oi join public.orders o on o.id = oi.order_id
     where o.seller_id = p_owner and o.status::text in ('paid', 'shipped', 'delivered') and o.created_at >= now() - make_interval(days => p_days) and (select ok from ok)
  ),
  added as (
    select coalesce(sum(a.have), 0)::int as n from a where a.ca >= now() - make_interval(days => p_days)
  )
  select jsonb_build_object(
    'cur', (select to_jsonb(cur) from cur),
    'pts', (select coalesce(jsonb_agg(jsonb_build_array(ser.day, ser.n) order by ser.day), '[]'::jsonb) from ser),
    'games', (select coalesce(jsonb_agg(jsonb_build_array(g.game, g.n) order by g.n desc), '[]'::jsonb) from (
      select st.game, case p_k when 1 then count(distinct st.card_id) when 2 then sum(st.sale) else sum(st.have) end::int as n
        from st where st.game <> '' group by st.game) g where g.n > 0),
    -- Podíl kusů na prodej podle her (%).
    'gameShare', (select coalesce(jsonb_agg(jsonb_build_array(g.game, g.pct) order by g.pct desc), '[]'::jsonb) from (
      select st.game, round(100.0 * sum(st.sale) / nullif(sum(st.have), 0))::int as pct
        from st where st.game <> '' group by st.game having sum(st.have) > 0) g),
    'conds', (select coalesce(jsonb_agg(jsonb_build_array(g.cond, g.n) order by g.n desc), '[]'::jsonb) from (
      select st.cond, sum(st.have)::int as n from st group by st.cond having sum(st.have) > 0) g),
    'places', (select coalesce(jsonb_agg(jsonb_build_array(g.k, g.n) order by g.k = '—', g.n desc), '[]'::jsonb) from (
      select y.k, y.n from (
        select split_part(st.loc, ' · ', 1) as k, sum(st.have)::int as n from st where st.loc <> '' group by 1 having sum(st.have) > 0
         order by 2 desc limit 5) y
      union all
      select '—', sum(st.have)::int from st where st.loc = '' having sum(st.have) > 0) g),
    'sets', (select coalesce(jsonb_agg(jsonb_build_array(g.l, g.n) order by g.n desc), '[]'::jsonb) from (
      select max(st.setname) || coalesce(' (' || max(st.code) || ')', '') as l, count(distinct st.card_id)::int as n
        from st where st.set_id is not null and st.have > 0 group by st.set_id order by 2 desc limit 5) g),
    'top', (select coalesce(jsonb_agg(jsonb_build_array(g.l, g.n) order by g.n desc), '[]'::jsonb) from (
      select kc.name || coalesce(' · ' || trim(coalesce(kc.code, '') || ' ' || coalesce(kc.number, '')), '') as l, kc.n
        from kc order by kc.n desc, kc.name limit 5) g),
    'per', (select jsonb_build_array(
      jsonb_build_array('1 kus', count(*) filter (where kc.n = 1)),
      jsonb_build_array('2–4 kusy', count(*) filter (where kc.n between 2 and 4)),
      jsonb_build_array('5–20 kusů', count(*) filter (where kc.n between 5 and 20)),
      jsonb_build_array('Víc než 20', count(*) filter (where kc.n > 20))) from kc),
    'interest', (select coalesce(jsonb_agg(jsonb_build_array(g.name, g.n) order by g.n desc), '[]'::jsonb) from (
      select max(st.name) as name, (select count(*) from public.card_watches w where w.card_id = st.card_id)::int as n
        from st where st.sale > 0 group by st.card_id order by 2 desc limit 4) g where g.n > 0),
    -- Kusy mimo prodej: bez ceny, odložené stranou (s cenou), zablokované; k tomu kusy v otevřených objednávkách.
    'notSale', (select jsonb_build_object(
      'noPrice', coalesce(sum(st.have - st.sale) filter (where st.price is null and not st.locked), 0),
      'keep', coalesce(sum(st.have - st.sale) filter (where st.price is not null and not st.locked), 0),
      'locked', coalesce(sum(st.have - st.sale) filter (where st.locked), 0),
      'orders', (select n from res)) from st),
    'ages', (select jsonb_build_array(
      jsonb_build_array('Do 30 dní', coalesce(sum(st.sale) filter (where st.listed < 30), 0)),
      jsonb_build_array('30–60 dní', coalesce(sum(st.sale) filter (where st.listed between 30 and 59), 0)),
      jsonb_build_array('60–90 dní', coalesce(sum(st.sale) filter (where st.listed between 60 and 89), 0)),
      jsonb_build_array('Přes 90 dní', coalesce(sum(st.sale) filter (where st.listed >= 90), 0))) from st where st.sale > 0),
    'moves', jsonb_build_object('added', (select n from added), 'sold', (select n from sold)))
  where (select ok from ok)
$$;
grant execute on function public.stock_detail(uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';

-- První záznam hned (dnešek).
select public.stock_daily_run();
