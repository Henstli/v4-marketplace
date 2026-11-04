-- Nespárované: řádky z nahrané tabulky, které nešly rovnou do skladu (karta nenalezena,
-- víc možností nebo chybějící údaj). Prodejce je dořeší v záložce Nespárované.
create table if not exists public.stock_unmatched (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Odkud řádek je: název souboru a číslo řádku
  file text check (char_length(file) <= 160),
  line int,
  -- none = karta nenalezena, multi = víc možností, data = karta sedí, chybí údaj (stav, jazyk, počet)
  reason text not null check (reason in ('none', 'multi', 'data')),
  game text check (char_length(game) <= 30),
  name text check (char_length(name) <= 160),
  set_code text check (char_length(set_code) <= 40),
  set_name text check (char_length(set_name) <= 120),
  number text check (char_length(number) <= 30),
  condition public.card_condition,
  language text check (char_length(language) <= 10),
  raw_condition text check (char_length(raw_condition) <= 40),
  raw_language text check (char_length(raw_language) <= 40),
  price_czk int check (price_czk > 0),
  quantity int not null default 1 check (quantity between 1 and 100000),
  graded text check (char_length(graded) <= 20),
  note text check (char_length(note) <= 200),
  -- Návrhy z katalogu [{id, slug, name, number, game, setCode, setName, image}], nejvýš 6
  candidates jsonb not null default '[]'::jsonb,
  ignored_at timestamptz
);
create index if not exists stock_unmatched_owner_idx on public.stock_unmatched (owner_id, created_at desc);
alter table public.stock_unmatched enable row level security;
grant select, insert, update (ignored_at, condition, language, quantity, price_czk), delete on public.stock_unmatched to authenticated;
grant usage on sequence public.stock_unmatched_id_seq to authenticated;
create policy "vlastní nespárované" on public.stock_unmatched for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
