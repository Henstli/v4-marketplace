-- Katalog: nejnižší cena, počet nabídek a vývoj ceny za 30 dní se předpočítají do card_market,
-- místo aby se při každém hledání znovu sčítaly všechny nabídky a celá historie cen.
-- Hledání vrací stejné výsledky: s filtrem nabídek (stav, jazyk, typ prodejce, prodejce) se nabídky dál počítají živě.

create table if not exists public.card_market (
  card_id uuid primary key references public.cards(id) on delete cascade,
  min_price integer,
  offers integer not null default 0,
  history integer[]
);
-- Jen pro funkce s právy vlastníka (search_catalog), přímo ji nikdo nečte.
alter table public.card_market enable row level security;
revoke all on public.card_market from anon, authenticated;

-- Přepočet vybraných karet (null = všech).
create or replace function public.card_market_refresh(p_cards uuid[] default null)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Upsert místo smazat a vložit: dvě souběžné úpravy stejné karty se nepohádají o klíč.
  with o as (
    select l.card_id, min(l.price_czk) as min_price, count(*)::int as offers
      from public.listings l join public.profiles p on p.id = l.seller_id
     where l.quantity > 0 and (p_cards is null or l.card_id = any(p_cards))
     group by l.card_id),
  h as (
    select ph.card_id, array_agg(ph.avg_price_czk order by ph.day) as history
      from public.price_history ph
     where ph.day >= current_date - 30 and (p_cards is null or ph.card_id = any(p_cards))
     group by ph.card_id),
  n as (
    select coalesce(o.card_id, h.card_id) as card_id, o.min_price, coalesce(o.offers, 0) as offers, h.history
      from o full join h on h.card_id = o.card_id),
  up as (
    insert into public.card_market as m (card_id, min_price, offers, history)
    select * from n
    on conflict (card_id) do update set min_price = excluded.min_price, offers = excluded.offers, history = excluded.history
      where (m.min_price, m.offers, m.history) is distinct from (excluded.min_price, excluded.offers, excluded.history))
  -- Karty, které už nemají nabídku ani historii, ze souhrnu vypadnou.
  delete from public.card_market m
   where (p_cards is null or m.card_id = any(p_cards))
     and not exists (select 1 from n where n.card_id = m.card_id);
end $$;
revoke execute on function public.card_market_refresh(uuid[]) from public, anon, authenticated;

-- Po každé změně nabídek nebo historie cen se přepočítají jen dotčené karty (jednou za příkaz, i u hromadného importu).
create or replace function public.card_market_sync()
  returns trigger language plpgsql security definer set search_path = '' as $$
declare v uuid[];
begin
  if tg_op = 'INSERT' then select array_agg(distinct card_id) into v from new_rows;
  elsif tg_op = 'DELETE' then select array_agg(distinct card_id) into v from old_rows;
  else select array_agg(distinct card_id) into v from (select card_id from new_rows union select card_id from old_rows) x;
  end if;
  if v is not null then perform public.card_market_refresh(v); end if;
  return null;
end $$;
revoke execute on function public.card_market_sync() from public, anon, authenticated;

create trigger card_market_ins after insert on public.listings referencing new table as new_rows for each statement execute function public.card_market_sync();
create trigger card_market_upd after update on public.listings referencing new table as new_rows old table as old_rows for each statement execute function public.card_market_sync();
create trigger card_market_del after delete on public.listings referencing old table as old_rows for each statement execute function public.card_market_sync();

create trigger card_market_ins after insert on public.price_history referencing new table as new_rows for each statement execute function public.card_market_sync();
create trigger card_market_upd after update on public.price_history referencing new table as new_rows old table as old_rows for each statement execute function public.card_market_sync();
create trigger card_market_del after delete on public.price_history referencing old table as old_rows for each statement execute function public.card_market_sync();

-- Okno 30 dní se posouvá o půlnoci (UTC) a souběžné úpravy stejné karty se mohou minout:
-- proto ještě každou hodinu celý přepočet (trvá zlomek sekundy).
select cron.unschedule('card-market-hourly') where exists (select 1 from cron.job where jobname = 'card-market-hourly');
select cron.schedule('card-market-hourly', '3 * * * *', 'select public.card_market_refresh()');

select public.card_market_refresh();
