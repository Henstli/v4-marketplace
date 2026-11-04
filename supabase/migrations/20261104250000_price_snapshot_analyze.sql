-- Po denním zápisu cen obnovit statistiky price_history. Bez nich plánovač počítal se 420 řádky
-- z ukázkových dat a search_catalog (úvodní stránka, řazení podle růstu) běžel 4,5 s místo 0,2 s.
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
  analyze public.price_history;
  return n;
end;
$$;
