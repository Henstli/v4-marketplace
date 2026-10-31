-- Moje kolekce (nahrazuje Sbírku a Wishlist): karty, které uživatel má, a jeho alba.
-- Album sady ukazuje všechny karty sady podle čísla, prázdná místa jsou chybějící karty (nový wishlist).
-- Vlastní album má vlastní seznam karet v pořadí, jaké si uživatel nastaví.
-- Nic se nemaže: jen nové tabulky a funkce.

-- Karty ve sbírce: kolik kusů které karty uživatel má.
create table public.collection_cards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.cards(id),
  quantity int not null default 1 check (quantity between 1 and 999),
  added_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
create index collection_cards_card_idx on public.collection_cards (card_id);

-- Alba: vzhled desek a obalů (1–20 podle návrhů), sada nebo vlastní výběr.
create table public.collection_albums (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 24),
  design smallint not null default 1 check (design between 1 and 20),
  sleeve smallint not null default 1 check (sleeve between 1 and 20),
  kind text not null check (kind in ('set', 'custom')),
  set_id uuid references public.card_sets(id),
  include_secret boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'set') = (set_id is not null))
);
create index collection_albums_user_idx on public.collection_albums (user_id, updated_at desc);

-- Karty vlastního alba v pořadí.
create table public.collection_album_cards (
  album_id uuid not null references public.collection_albums(id) on delete cascade,
  card_id uuid not null references public.cards(id),
  position int not null,
  primary key (album_id, card_id)
);
create index collection_album_cards_pos_idx on public.collection_album_cards (album_id, position);

alter table public.collection_cards enable row level security;
alter table public.collection_albums enable row level security;
alter table public.collection_album_cards enable row level security;

create policy "collection_cards own" on public.collection_cards
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "collection_albums own" on public.collection_albums
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "collection_album_cards own" on public.collection_album_cards
  for all to authenticated
  using (exists (select 1 from public.collection_albums a where a.id = album_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.collection_albums a where a.id = album_id and a.user_id = auth.uid()));

-- Přidání karet do sbírky (a případně na konec vlastního alba) jedním voláním.
-- p_cards: pole id karet, opakované id = další kus.
create or replace function public.collection_add(p_cards uuid[], p_album uuid default null) returns int
  language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
  v_pos int;
  v_n int := 0;
  v_card uuid;
begin
  if v_uid is null then raise exception 'Přihlaste se'; end if;
  if p_album is not null then
    select kind into v_kind from public.collection_albums where id = p_album and user_id = v_uid;
    if v_kind is null then raise exception 'Album nenalezeno'; end if;
  end if;
  foreach v_card in array coalesce(p_cards, '{}') loop
    insert into public.collection_cards (user_id, card_id) values (v_uid, v_card)
      on conflict (user_id, card_id) do update set quantity = least(999, public.collection_cards.quantity + 1);
    v_n := v_n + 1;
  end loop;
  if v_kind = 'custom' then
    select coalesce(max(position), 0) into v_pos from public.collection_album_cards where album_id = p_album;
    insert into public.collection_album_cards (album_id, card_id, position)
      select p_album, c, v_pos + row_number() over (order by o)
      from (select distinct on (c) c, o from unnest(p_cards) with ordinality as t(c, o) order by c, o) d
      where not exists (select 1 from public.collection_album_cards x where x.album_id = p_album and x.card_id = d.c)
      order by o;
  end if;
  if p_album is not null then
    update public.collection_albums set updated_at = now() where id = p_album;
  end if;
  return v_n;
end;
$$;
revoke execute on function public.collection_add(uuid[], uuid) from public, anon;
grant execute on function public.collection_add(uuid[], uuid) to authenticated;
