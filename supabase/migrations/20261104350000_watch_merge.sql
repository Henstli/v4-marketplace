-- Hledám (stock_wants) a Čekám na (card_watches) jsou jeden seznam: Hlídané karty v Hlídání a příkazech.
-- Hlídání má nově volitelnou nejvyšší cenu a nejhorší stav. Upozornění (a e-mail) přijde, jen když se objeví
-- nabídka za tu cenu a v tom stavu. Hlídání po upozornění zůstává (karta je pak v „Dostupné za vaši cenu“),
-- další upozornění na stejnou kartu nejdřív za den. stock_wants se už nezapisuje, data se jen přenesou.

alter table public.card_watches
  add column if not exists max_price_czk int check (max_price_czk > 0),
  add column if not exists min_condition public.card_condition,
  add column if not exists alerted_at timestamptz;
grant update (max_price_czk, min_condition) on public.card_watches to authenticated;

insert into public.card_watches (user_id, card_id, created_at, max_price_czk, min_condition)
  select sw.user_id, sw.card_id, sw.created_at, sw.max_price_czk, sw.min_condition from public.stock_wants sw
  on conflict (user_id, card_id) do update set max_price_czk = excluded.max_price_czk, min_condition = excluded.min_condition;

create or replace function public.card_watch_restock() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.quantity > 0 and new.hidden_qty is null and new.removed_at is null
     and (tg_op = 'INSERT' or old.quantity = 0 or old.hidden_qty is not null or old.removed_at is not null
          or (new.price_czk is not null and (old.price_czk is null or new.price_czk < old.price_czk))) then
    with hit as (
      update public.card_watches w set alerted_at = now()
       where w.card_id = new.card_id and w.user_id <> new.seller_id
         and (w.max_price_czk is null or (new.price_czk is not null and new.price_czk <= w.max_price_czk))
         and (w.min_condition is null or new.condition <= w.min_condition)
         and (w.alerted_at is null or w.alerted_at < now() - interval '1 day')
      returning w.user_id, w.card_id
    )
    insert into public.watch_alerts (user_id, card_id) select user_id, card_id from hit;
  end if;
  return new;
end;
$$;

create or replace trigger listings_watch_restock after insert or update of quantity, price_czk, hidden_qty, removed_at on public.listings
  for each row execute function public.card_watch_restock();

-- Hlídané karty s nejlevnější nabídkou ve stavu stejném nebo lepším a příznakem nového upozornění.
create or replace function public.watch_view()
  returns table (card_id uuid, slug text, name text, number text, image_url text, game_id text, set_code text, set_name text,
                 max_price_czk int, min_condition public.card_condition, created_at timestamptz, low_czk int, offers int, fresh boolean)
  language sql stable set search_path = '' as $$
  select w.card_id, c.slug, c.name, c.number, c.image_url, c.game_id, cs.code, cs.name, w.max_price_czk, w.min_condition, w.created_at,
    (select min(l.price_czk) from public.listings l where l.card_id = w.card_id and l.quantity > 0 and l.price_czk is not null
        and l.condition <= coalesce(w.min_condition, 'PL'::public.card_condition) and l.hidden_qty is null and l.removed_at is null and l.seller_id <> w.user_id),
    (select count(*)::int from public.listings l where l.card_id = w.card_id and l.quantity > 0
        and l.condition <= coalesce(w.min_condition, 'PL'::public.card_condition) and l.hidden_qty is null and l.removed_at is null and l.seller_id <> w.user_id),
    exists (select 1 from public.watch_alerts a where a.user_id = w.user_id and a.card_id = w.card_id and a.seen_at is null)
  from public.card_watches w
  join public.cards c on c.id = w.card_id
  left join public.card_sets cs on cs.id = c.set_id
  where w.user_id = (select auth.uid())
  order by w.created_at desc
$$;
grant execute on function public.watch_view() to authenticated;

-- Chybí do sad: kolik chybějících karet hlídáte, teď z card_watches.
create or replace function public.stock_sets_extra(p_sets uuid[])
  returns table (set_id uuid, images text[], low_sum int, watched int, missing int)
  language sql stable set search_path = '' as $$
  with miss as (
    select c.set_id, c.id, c.number, c.image_url
      from public.cards c
     where c.set_id = any(p_sets[1:60]) and not c.hidden
       and not exists (select 1 from public.listings l join public.listing_stock s on s.listing_id = l.id
                        where l.card_id = c.id and l.seller_id = (select auth.uid()) and l.quantity + s.keep_qty > 0)
  )
  select m.set_id,
    (array_agg(m.image_url order by m.number) filter (where m.image_url is not null))[1:3],
    coalesce(sum((select min(l.price_czk) from public.listings l where l.card_id = m.id and l.quantity > 0 and l.price_czk is not null
        and l.hidden_qty is null and l.removed_at is null and l.seller_id <> (select auth.uid()))), 0)::int,
    count(*) filter (where exists (select 1 from public.card_watches w where w.user_id = (select auth.uid()) and w.card_id = m.id))::int,
    count(*)::int
  from miss m
  group by m.set_id
$$;
grant execute on function public.stock_sets_extra(uuid[]) to authenticated;
