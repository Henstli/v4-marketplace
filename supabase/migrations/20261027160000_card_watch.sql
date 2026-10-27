-- Čekací pořadník: kupující hlídá kartu, která není skladem (nebo ji někdo rezervoval).
-- Jakmile je karta znovu k mání, dostanou všichni čekající upozornění a hlídání skončí.

create table public.card_watches (
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
alter table public.card_watches enable row level security;
grant select, insert, delete on public.card_watches to authenticated;
create policy "vlastní hlídání" on public.card_watches for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Upozornění „karta je znovu skladem“. emailed_at vyplní server po odeslání e-mailu.
create table public.watch_alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  emailed_at timestamptz
);
create index watch_alerts_user_idx on public.watch_alerts (user_id) where seen_at is null;
create index watch_alerts_unsent_idx on public.watch_alerts (created_at) where emailed_at is null;
alter table public.watch_alerts enable row level security;
grant select, update (seen_at), delete on public.watch_alerts to authenticated;
create policy "vlastní upozornění" on public.watch_alerts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Nabídka se objevila nebo doplnila z nuly (nová, vrácená rezervace, úprava skladu, import):
-- všem, kdo kartu hlídají (kromě prodejce), vznikne upozornění a hlídání se smaže.
create or replace function public.card_watch_restock() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.quantity > 0 and (tg_op = 'INSERT' or old.quantity = 0) then
    with fired as (
      delete from public.card_watches w
      where w.card_id = new.card_id and w.user_id <> new.seller_id
      returning w.user_id, w.card_id
    )
    insert into public.watch_alerts (user_id, card_id) select user_id, card_id from fired;
  end if;
  return new;
end;
$$;

create trigger listings_watch_restock after insert or update of quantity on public.listings
  for each row execute function public.card_watch_restock();
