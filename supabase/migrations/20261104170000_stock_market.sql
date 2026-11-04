-- Sklad, fáze 4: Trh (poptávka u obchodu, celý trh, ceny proti trhu) a automatické ceny.
-- Poptávka jsou jen souhrnná čísla (kolik lidí kartu hledá nebo hlídá), nikdy kdo.
-- Bez revoke (potvrzovací dotaz konektoru se nezobrazí): práva hlídají kontroly přímo ve funkcích.

-- Poptávka u obchodu: karty, které lidé hledají (Hledám) nebo hlídají (Dát vědět), s tím, kolik jich obchod má.
create or replace function public.market_demand(p_owner uuid)
  returns table (card_id uuid, slug text, name text, set_code text, number text, image_url text, game_id text,
                 wanters int, recent int, on_sale int, keep int, market_czk int, low_czk int)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.stock_perm(p_owner, 'view') then raise exception 'Na tuto změnu nemáte právo' using errcode = '42501'; end if;
  return query
  with w as (
    select x.card_id, count(distinct x.user_id)::int n, count(distinct x.user_id) filter (where x.created_at > now() - interval '7 days')::int r
      from (select sw.card_id, sw.user_id, sw.created_at from public.stock_wants sw
            union all select cw.card_id, cw.user_id, cw.created_at from public.card_watches cw) x
     where x.user_id <> p_owner
     group by x.card_id
  ), mine as (
    select l.card_id, sum(l.quantity)::int q, sum(s.keep_qty)::int k
      from public.listings l join public.listing_stock s on s.listing_id = l.id
     where l.seller_id = p_owner and l.removed_at is null and l.hidden_qty is null
     group by l.card_id
  )
  select c.id, c.slug, c.name, upper(coalesce(cs.code, '')), c.number, c.image_url, c.game_id, w.n, w.r,
    coalesce(m.q, 0), coalesce(m.k, 0),
    (select ph.avg_price_czk from public.price_history ph where ph.card_id = c.id order by ph.day desc limit 1),
    (select min(l.price_czk) from public.listings l where l.card_id = c.id and l.quantity > 0 and l.price_czk is not null
        and l.hidden_qty is null and l.removed_at is null and l.seller_id <> p_owner)
  from w join public.cards c on c.id = w.card_id
  left join public.card_sets cs on cs.id = c.set_id
  left join mine m on m.card_id = c.id
  order by w.n desc, w.r desc, c.name
  limit 300;
end;
$$;
grant execute on function public.market_demand(uuid) to authenticated;

-- Celý trh: nejhledanější karty a poptávka podle her (za posledních p_days dní přibylo).
create or replace function public.market_top(p_days int default 7)
  returns table (card_id uuid, slug text, name text, set_code text, number text, image_url text, game_id text,
                 wanters int, recent int, offers int, low_czk int, market_czk int)
  language sql stable security definer set search_path = '' as $$
  with w as (
    select x.card_id, count(distinct x.user_id)::int n,
      count(distinct x.user_id) filter (where x.created_at > now() - make_interval(days => least(greatest(p_days, 1), 90)))::int r
      from (select sw.card_id, sw.user_id, sw.created_at from public.stock_wants sw
            union all select cw.card_id, cw.user_id, cw.created_at from public.card_watches cw) x
     where (select auth.uid()) is not null
     group by x.card_id
     order by 2 desc
     limit 100
  )
  select c.id, c.slug, c.name, upper(coalesce(cs.code, '')), c.number, c.image_url, c.game_id, w.n, w.r,
    (select count(*)::int from public.listings l where l.card_id = c.id and l.quantity > 0 and l.hidden_qty is null and l.removed_at is null),
    (select min(l.price_czk) from public.listings l where l.card_id = c.id and l.quantity > 0 and l.price_czk is not null
        and l.hidden_qty is null and l.removed_at is null),
    (select ph.avg_price_czk from public.price_history ph where ph.card_id = c.id order by ph.day desc limit 1)
  from w join public.cards c on c.id = w.card_id
  left join public.card_sets cs on cs.id = c.set_id
  order by w.n desc, w.r desc
$$;
grant execute on function public.market_top(int) to authenticated;

create or replace function public.market_games(p_days int default 7)
  returns table (game_id text, wanters int, recent int)
  language sql stable security definer set search_path = '' as $$
  select c.game_id, count(distinct x.user_id)::int,
    count(distinct x.user_id) filter (where x.created_at > now() - make_interval(days => least(greatest(p_days, 1), 90)))::int
    from (select sw.card_id, sw.user_id, sw.created_at from public.stock_wants sw
          union all select cw.card_id, cw.user_id, cw.created_at from public.card_watches cw) x
    join public.cards c on c.id = x.card_id
   where c.game_id is not null and (select auth.uid()) is not null
   group by c.game_id
   order by 2 desc
$$;
grant execute on function public.market_games(int) to authenticated;

-- Vaše ceny: nejlevnější nabídka jiných prodejců na kartu (stejný stav a jazyk, jinak jakákoli).
create or replace function public.market_prices(p_owner uuid)
  returns table (listing_id uuid, low_same int, low_any int)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.stock_perm(p_owner, 'view') then raise exception 'Na tuto změnu nemáte právo' using errcode = '42501'; end if;
  return query
  select l.id,
    (select min(o.price_czk) from public.listings o where o.card_id = l.card_id and o.condition = l.condition and o.language = l.language
        and o.quantity > 0 and o.price_czk is not null and o.hidden_qty is null and o.removed_at is null and o.seller_id <> p_owner),
    (select min(o.price_czk) from public.listings o where o.card_id = l.card_id
        and o.quantity > 0 and o.price_czk is not null and o.hidden_qty is null and o.removed_at is null and o.seller_id <> p_owner)
  from public.listings l
  where l.seller_id = p_owner and l.quantity > 0 and l.removed_at is null and l.hidden_qty is null;
end;
$$;
grant execute on function public.market_prices(uuid) to authenticated;

-- ===== Automatické ceny =====

create table public.stock_autoprice (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  mode text not null default 'under' check (mode in ('under', 'market', 'over')),
  pct numeric(4, 1) not null default 2 check (pct between 0 and 50),
  floor_pct int not null default 10 check (floor_pct between 0 and 500),
  cap_pct int not null default 15 check (cap_pct between 1 and 50),
  excl_locations text[] not null default '{}',
  excl_games text[] not null default '{}',
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.stock_autoprice enable row level security;
grant select, insert, update (owner_id, enabled, mode, pct, floor_pct, cap_pct, excl_locations, excl_games, updated_at) on public.stock_autoprice to authenticated;
create policy "automatické ceny čte tým" on public.stock_autoprice for select to authenticated
  using (public.stock_perm(owner_id, 'price') or public.stock_perm(owner_id, 'conn'));
create policy "automatické ceny nastaví" on public.stock_autoprice for insert to authenticated with check (public.stock_perm(owner_id, 'conn'));
create policy "automatické ceny upraví" on public.stock_autoprice for update to authenticated
  using (public.stock_perm(owner_id, 'conn')) with check (public.stock_perm(owner_id, 'conn'));

-- Výpočet nových cen podle pravidel obchodu (karty na prodej s cenou a s tržní cenou).
create or replace function public.stock_autoprice_calc(p_owner uuid)
  returns table (listing_id uuid, card_id uuid, name text, set_code text, condition text, old_price int, new_price int, market_czk int, reason text)
  language sql stable security invoker set search_path = '' as $$
  with r as (select * from public.stock_autoprice where owner_id = p_owner),
  base as (
    select l.id, l.card_id, c.name, upper(coalesce(cs.code, '')) || ' ' || c.number set_code, l.condition::text cond, l.price_czk old,
      (select ph.avg_price_czk from public.price_history ph where ph.card_id = c.id order by ph.day desc limit 1) mk,
      s.buy_price_czk buy, r.*
      from r
      join public.listings l on l.seller_id = r.owner_id
      join public.listing_stock s on s.listing_id = l.id
      join public.cards c on c.id = l.card_id
      left join public.card_sets cs on cs.id = c.set_id
     where l.quantity > 0 and l.price_czk is not null and l.removed_at is null and l.hidden_qty is null
       and not (coalesce(s.location, '') = any(r.excl_locations))
       and not (coalesce(c.game_id, '') = any(r.excl_games))
  ),
  t as (
    select b.*, b.mk * case b.mode when 'under' then 1 - b.pct / 100.0 when 'over' then 1 + b.pct / 100.0 else 1 end target,
      case when b.buy is not null then b.buy * (1 + b.floor_pct / 100.0) end fl
      from base b where b.mk is not null
  ),
  f as (
    select t.*, greatest(t.target, coalesce(t.fl, 0)) v1, (t.fl is not null and t.fl > t.target) floored from t
  ),
  g as (
    select f.*, least(greatest(f.v1, f.old * (1 - f.cap_pct / 100.0)), f.old * (1 + f.cap_pct / 100.0)) v2 from f
  )
  select g.id, g.card_id, g.name, g.set_code, g.cond, g.old, greatest(1, round(g.v2))::int, g.mk,
    case when g.v2 > g.v1 + 0.5 then 'nejvýš −' || g.cap_pct || ' % za noc'
         when g.v2 < g.v1 - 0.5 then 'nejvýš +' || g.cap_pct || ' % za noc'
         when g.floored then 'pojistka nákupní ceny'
         else 'trh ' || g.mk || ' Kč' end
  from g
  where greatest(1, round(g.v2))::int <> g.old
$$;

-- Náhled „co se stane dnes v noci“ pro záložku Trh.
create or replace function public.stock_autoprice_preview(p_owner uuid)
  returns table (listing_id uuid, name text, set_code text, condition text, old_price int, new_price int, market_czk int, reason text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.stock_perm(p_owner, 'price') or public.stock_perm(p_owner, 'conn')) then
    raise exception 'Na tuto změnu nemáte právo' using errcode = '42501';
  end if;
  return query select c.listing_id, c.name, c.set_code, c.condition, c.old_price, c.new_price, c.market_czk, c.reason
    from public.stock_autoprice_calc(p_owner) c order by abs(c.new_price - c.old_price) desc limit 500;
end;
$$;
grant execute on function public.stock_autoprice_preview(uuid) to authenticated;

-- Noční přepočet (cron ve 3:00 se service_role klíčem): nové ceny a záznam do Historie s Vrátit.
create or replace function public.stock_autoprice_run()
  returns int language plpgsql security definer set search_path = '' as $$
declare
  o uuid;
  before jsonb;
  v_rows jsonb;
  n int;
  total int := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Jen noční přepočet' using errcode = '42501'; end if;
  for o in select a.owner_id from public.stock_autoprice a where a.enabled loop
    select coalesce(jsonb_agg(jsonb_build_object('listing_id', c.listing_id, 'name', c.name, 'old_price', c.old_price, 'new_price', c.new_price)), '[]'::jsonb)
      into v_rows from public.stock_autoprice_calc(o) c;
    n := jsonb_array_length(v_rows);
    if n > 0 then
      select jsonb_agg(jsonb_build_object('id', l.id, 'card_id', l.card_id, 'price_czk', l.price_czk, 'negotiable', l.negotiable, 'quantity', l.quantity,
          'keep_qty', s.keep_qty, 'trade_qty', s.trade_qty, 'location', s.location,
          'total_before', l.quantity + s.keep_qty, 'total_after', l.quantity + s.keep_qty))
        into before
        from public.listings l join public.listing_stock s on s.listing_id = l.id
       where l.id in (select x.listing_id from jsonb_to_recordset(v_rows) x(listing_id uuid));
      update public.listings l set price_czk = x.new_price
        from jsonb_to_recordset(v_rows) x(listing_id uuid, new_price int) where l.id = x.listing_id;
      insert into public.stock_events (owner_id, actor_id, kind, title, detail, undo, sample)
      values (o, null, 'price',
        'Automatické ceny · ' || n || case when n = 1 then ' karta' when n < 5 then ' karty' else ' karet' end,
        (select count(*) filter (where x.new_price > x.old_price) || ' dráž, ' || count(*) filter (where x.new_price < x.old_price) || ' levněji'
           from jsonb_to_recordset(v_rows) x(old_price int, new_price int)),
        before,
        (select jsonb_agg(jsonb_build_array(y.name, y.old_price || ' Kč', y.new_price || ' Kč'))
           from (select * from jsonb_to_recordset(v_rows) x(name text, old_price int, new_price int)
                  order by abs(x.new_price - x.old_price) desc limit 20) y));
      total := total + n;
    end if;
    update public.stock_autoprice set last_run_at = now() where owner_id = o;
  end loop;
  return total;
end;
$$;
