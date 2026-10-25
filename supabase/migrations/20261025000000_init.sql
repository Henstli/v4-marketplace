-- V4market: základní schéma první verze (katalog, nabídky, objednávky, hodnocení).
-- Zatím neaplikováno na žádný Supabase projekt.

-- unaccent není immutable, generovaný sloupec potřebuje obal.
create extension if not exists unaccent with schema extensions;
create or replace function unaccent_immutable(text) returns text
  language sql immutable parallel safe as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

create type seller_kind as enum ('private', 'shop');
create type card_condition as enum ('MT', 'NM', 'EX', 'GD', 'LP', 'PL');
create type order_status as enum ('pending_payment', 'paid', 'shipped', 'delivered', 'cancelled');

create table games (
  id text primary key,
  name text not null,
  live boolean not null default false,
  sort_order int not null default 0
);

create table card_sets (
  id uuid primary key default gen_random_uuid(),
  game_id text not null references games(id),
  code text not null,
  name text not null,
  released_on date,
  unique (game_id, code)
);

create table cards (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references card_sets(id),
  slug text not null unique,
  name text not null,
  number text not null,
  rarity text,
  image_url text,
  -- id v externím katalogu (Pokémon TCG API, Scryfall), kvůli importu
  external_id text,
  search tsvector generated always as (to_tsvector('simple', unaccent_immutable(name || ' ' || number))) stored
);

create index cards_search_idx on cards using gin (search);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  kind seller_kind not null default 'private',
  country text not null default 'CZ' check (country in ('CZ', 'SK')),
  created_at timestamptz not null default now()
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id),
  seller_id uuid not null references profiles(id) on delete cascade,
  price_czk int not null check (price_czk > 0),
  condition card_condition not null,
  language text not null,
  quantity int not null default 1 check (quantity >= 0),
  graded text,
  note text,
  created_at timestamptz not null default now()
);

create index listings_card_idx on listings (card_id, price_czk) where quantity > 0;

create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references profiles(id),
  seller_id uuid not null references profiles(id),
  status order_status not null default 'pending_payment',
  total_czk int not null,
  shipping_czk int not null default 0,
  created_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  listing_id uuid not null references listings(id),
  quantity int not null check (quantity > 0),
  price_czk int not null
);

create table reviews (
  order_id uuid primary key references orders(id),
  seller_id uuid not null references profiles(id),
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

-- Denní průměrná prodejní cena pro grafy.
create table price_history (
  card_id uuid not null references cards(id),
  day date not null,
  avg_price_czk int not null,
  sales int not null default 0,
  primary key (card_id, day)
);

-- Zabezpečení řádků: katalog a nabídky čte každý, zapisuje jen vlastník.
alter table games enable row level security;
alter table card_sets enable row level security;
alter table cards enable row level security;
alter table price_history enable row level security;
alter table profiles enable row level security;
alter table listings enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table reviews enable row level security;

create policy "katalog čte každý" on games for select using (true);
create policy "sady čte každý" on card_sets for select using (true);
create policy "karty čte každý" on cards for select using (true);
create policy "ceny čte každý" on price_history for select using (true);
create policy "profily čte každý" on profiles for select using (true);
create policy "vlastní profil" on profiles for update using (auth.uid() = id);
create policy "nabídky čte každý" on listings for select using (true);
create policy "vlastní nabídky" on listings for all using (auth.uid() = seller_id) with check (auth.uid() = seller_id);
create policy "objednávky účastníků" on orders for select using (auth.uid() in (buyer_id, seller_id));
create policy "položky účastníků" on order_items for select
  using (exists (select 1 from orders o where o.id = order_id and auth.uid() in (o.buyer_id, o.seller_id)));
create policy "hodnocení čte každý" on reviews for select using (true);
create policy "hodnotí kupující" on reviews for insert
  with check (exists (select 1 from orders o where o.id = order_id and o.buyer_id = auth.uid() and o.status = 'delivered'));

insert into games (id, name, live, sort_order) values
  ('sport', 'Hokej a sport', true, 1),
  ('pokemon', 'Pokémon', true, 2),
  ('magic', 'Magic: The Gathering', true, 3),
  ('onepiece', 'One Piece', false, 4),
  ('lorcana', 'Lorcana', false, 5),
  ('riftbound', 'Riftbound', false, 6),
  ('cyberpunk', 'Cyberpunk', false, 7);
