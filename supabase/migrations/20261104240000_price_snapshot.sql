-- Denní záznam tržních cen: price_history dosud plnila jen ukázková data, takže pruh nad tabulkou neměl
-- z čeho spočítat vývoj hodnoty ani nejvíc zdraženou kartu. Každou noc (cron /api/cron/ceny) se zapíše
-- cena každé nabízené karty: průměr prodejů za ten den, jinak nejnižší aktuální nabídka.

create or replace function public.price_snapshot() returns int
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  -- Spouští jen noční úloha (service role), ne přihlášení uživatelé.
  if coalesce((select auth.role()), '') in ('anon', 'authenticated') then raise exception 'not allowed'; end if;
  insert into public.price_history (card_id, day, avg_price_czk, sales)
  select c.card_id, current_date, coalesce(s.avg, c.low), coalesce(s.cnt, 0)
    from (select l.card_id, min(l.price_czk) as low from public.listings l
           where l.quantity > 0 and l.price_czk is not null and l.hidden_qty is null and l.removed_at is null
           group by l.card_id) c
    left join (select l.card_id, round(sum(oi.price_czk * oi.quantity)::numeric / nullif(sum(oi.quantity), 0))::int as avg,
                      sum(oi.quantity)::int as cnt
                 from public.order_items oi
                 join public.orders o on o.id = oi.order_id
                 join public.listings l on l.id = oi.listing_id
                where o.status in ('paid', 'shipped', 'delivered') and o.created_at >= current_date
                group by l.card_id) s on s.card_id = c.card_id
  on conflict (card_id, day) do update set avg_price_czk = excluded.avg_price_czk, sales = excluded.sales;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Pruh nad tabulkou: vývoj hodnoty za 30 dní a karta, která za 30 dní nejvíc zdražila (v Kč za kus).
create or replace function public.stock_riser(p_owner uuid)
  returns table (trend numeric, card_id uuid, name text, from_czk int, to_czk int)
  language sql stable security definer set search_path = '' as $$
  with own as (
    select l.card_id, sum(l.quantity + coalesce(s.keep_qty, 0))::int as n
      from public.listings l left join public.listing_stock s on s.listing_id = l.id
     where l.seller_id = p_owner and l.removed_at is null and public.stock_perm(p_owner, 'view')
     group by l.card_id having sum(l.quantity + coalesce(s.keep_qty, 0)) > 0
  ), pr as (
    select o.card_id, o.n,
      (select ph.avg_price_czk from public.price_history ph where ph.card_id = o.card_id and ph.day >= current_date - 30 order by ph.day limit 1) as f,
      (select ph.avg_price_czk from public.price_history ph where ph.card_id = o.card_id and ph.day >= current_date - 30 order by ph.day desc limit 1) as t,
      (select count(*) from public.price_history ph where ph.card_id = o.card_id and ph.day >= current_date - 30) as k
      from own o
  ), tr as (
    select case when sum(f * n) filter (where k > 1) > 0
      then round((sum(t * n) filter (where k > 1)::numeric / sum(f * n) filter (where k > 1) - 1) * 100, 1) end as trend
      from pr
  ), top as (
    select pr.card_id, c.name, pr.f, pr.t from pr join public.cards c on c.id = pr.card_id
     where pr.k > 1 and pr.t > pr.f order by pr.t - pr.f desc, pr.t desc limit 1
  )
  select tr.trend, top.card_id, top.name, top.f, top.t from tr left join top on true
$$;
grant execute on function public.stock_riser(uuid) to authenticated;
