-- Sklad a Sbírka (fáze 1): řádek nabídky (listings) je zároveň řádek skladu.
-- listings.quantity = kusy na prodej (veřejné, jako dosud). Neveřejné údaje skladu (kusy mimo prodej,
-- výměna, umístění, nákupní cena) jsou v listing_stock, kterou čte jen vlastník.
-- Mám = quantity + keep_qty. Objednávky dál mění jen quantity, takže se sklad srovná sám.

create table public.listing_stock (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  keep_qty int not null default 0 check (keep_qty >= 0 and keep_qty <= 100000),
  trade_qty int not null default 0 check (trade_qty >= 0 and trade_qty <= 100000),
  location text check (char_length(location) <= 60),
  buy_price_czk int check (buy_price_czk >= 0),
  source text not null default 'manual' check (source in ('manual', 'import', 'photo', 'app')),
  listed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index listing_stock_seller_idx on public.listing_stock (seller_id);
alter table public.listing_stock enable row level security;
grant select, insert, update (keep_qty, trade_qty, location, buy_price_czk, source, listed_at, updated_at), delete
  on public.listing_stock to authenticated;
create policy "vlastní sklad" on public.listing_stock for all to authenticated
  using (seller_id = (select auth.uid()))
  with check (seller_id = (select auth.uid())
    and exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid())));

-- Dosavadní nabídky dostanou řádek skladu (vše na prodej, nic mimo prodej).
insert into public.listing_stock (listing_id, seller_id, listed_at, source)
select l.id, l.seller_id, case when l.quantity > 0 then l.created_at end, 'manual'
from public.listings l
on conflict do nothing;

-- Každá nová nabídka (i ze starších cest: Prodat, import) dostane řádek skladu.
create or replace function public.listing_stock_row() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.listing_stock (listing_id, seller_id, listed_at)
  values (new.id, new.seller_id, case when new.quantity > 0 then now() end)
  on conflict do nothing;
  return new;
end;
$$;
revoke execute on function public.listing_stock_row() from public, anon, authenticated;
create trigger listings_stock_row after insert on public.listings
  for each row execute function public.listing_stock_row();

-- Do skladu jde přidat kartu i bez dopravy a platby, prodávat (quantity > 0) až s nimi.
alter policy "vystavit jen s dopravou a platbou" on public.listings
  with check (quantity = 0 or coalesce(public.seller_ready((select auth.uid())), false));
create policy "prodávat jen s dopravou a platbou" on public.listings as restrictive for update to authenticated
  using (true)
  with check (quantity = 0 or coalesce(public.seller_ready((select auth.uid())), false));

create index listings_seller_idx on public.listings (seller_id, created_at desc);

-- Historie skladu: co se změnilo, kdo to udělal a jak to vrátit.
create table public.stock_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('sale', 'stock', 'price', 'sync')),
  title text not null check (char_length(title) <= 200),
  detail text check (char_length(detail) <= 300),
  -- Vrácení: stav řádků před změnou [{id, price_czk, negotiable, quantity, keep_qty, trade_qty, location}]
  undo jsonb,
  -- Ukázka změn pro Detail: [[název, před, po], …], nejvýš 20
  sample jsonb,
  undone_at timestamptz
);
create index stock_events_owner_idx on public.stock_events (owner_id, created_at desc);
alter table public.stock_events enable row level security;
grant select, insert (owner_id, actor_id, kind, title, detail, undo, sample), update (undone_at)
  on public.stock_events to authenticated;
create policy "vlastní historie skladu" on public.stock_events for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (actor_id is null or actor_id = (select auth.uid())));

-- Hledám: karty, které sběratel shání, s nejvyšší cenou a nejhorším stavem.
create table public.stock_wants (
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  max_price_czk int check (max_price_czk > 0),
  min_condition public.card_condition not null default 'EX',
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
alter table public.stock_wants enable row level security;
grant select, insert, update (max_price_czk, min_condition), delete on public.stock_wants to authenticated;
create policy "vlastní hledané karty" on public.stock_wants for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
