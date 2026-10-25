-- Sportovní karty nemají veřejný katalog: prodejce kartu navrhne (jméno, sada, číslo, fotka)
-- a správce ji schválí. Teprve schválená karta se objeví v katalogu.

-- Správci webu. Tabulka nemá žádná práva pro anon/authenticated, ptá se jen funkce is_admin().
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Skrytá karta se nikde nezobrazí (bez mazání, objednávky na ni dál odkazují).
alter table public.cards add column hidden boolean not null default false;
create policy "skryté karty nevidí nikdo" on public.cards as restrictive for select using (not hidden);

-- Ukázkové sportovní karty stahujeme, jejich nabídky končí.
update public.cards set hidden = true
where set_id in (select id from public.card_sets where game_id = 'sport');
update public.listings set quantity = 0
where card_id in (select c.id from public.cards c join public.card_sets s on s.id = c.set_id where s.game_id = 'sport');

-- Návrhy nových karet
create type public.submission_status as enum ('pending', 'approved', 'rejected');

create table public.card_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references public.profiles(id) on delete cascade,
  game_id text not null default 'sport' references public.games(id),
  player text not null check (char_length(player) between 2 and 80),
  season text not null check (char_length(season) between 4 and 20),
  manufacturer text not null check (char_length(manufacturer) between 2 and 40),
  set_name text not null check (char_length(set_name) between 2 and 80),
  number text not null check (char_length(number) between 1 and 20),
  variant text check (char_length(variant) <= 60),
  note text check (char_length(note) <= 300),
  image_path text not null,
  status public.submission_status not null default 'pending',
  reject_reason text check (char_length(reject_reason) <= 300),
  card_id uuid references public.cards(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create index card_submissions_status_idx on public.card_submissions (status, created_at);
create index card_submissions_user_idx on public.card_submissions (submitted_by, created_at desc);

alter table public.card_submissions enable row level security;
create policy "vlastní návrhy a správce" on public.card_submissions for select
  using (submitted_by = auth.uid() or public.is_admin());
create policy "nový návrh" on public.card_submissions for insert
  with check (
    submitted_by = auth.uid() and status = 'pending' and card_id is null and reviewed_at is null
    and game_id = 'sport' and image_path like auth.uid()::text || '/%'
  );
grant select, insert on public.card_submissions to authenticated;

-- Schválení nebo zamítnutí návrhu (jen správce). Vrací slug nové karty.
create or replace function public.review_card_submission(target uuid, approve boolean, reason text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.card_submissions;
  set_title text;
  set_code text;
  new_set uuid;
  new_slug text;
  new_card uuid;
begin
  if not public.is_admin() then
    raise exception 'Schvalovat může jen správce';
  end if;
  select * into s from public.card_submissions where id = target for update;
  if not found then raise exception 'Návrh neexistuje'; end if;
  if s.status <> 'pending' then raise exception 'Návrh už je vyřízený'; end if;

  if not approve then
    update public.card_submissions
      set status = 'rejected', reject_reason = nullif(trim(reason), ''), reviewed_at = now(), reviewed_by = auth.uid()
      where id = target;
    return null;
  end if;

  set_title := concat_ws(' ', s.season, s.manufacturer, s.set_name);
  set_code := upper(left(regexp_replace(public.unaccent_immutable(set_title), '[^A-Za-z0-9]+', '', 'g'), 32));
  insert into public.card_sets (game_id, code, name)
    values (s.game_id, set_code, set_title)
    on conflict (game_id, code) do update set name = public.card_sets.name
    returning id into new_set;

  new_slug := trim(both '-' from lower(regexp_replace(
    public.unaccent_immutable(concat_ws('-', s.player, s.season, s.manufacturer, s.set_name, s.number, nullif(s.variant, ''))), '[^A-Za-z0-9]+', '-', 'g')));
  if exists (select 1 from public.cards where slug = new_slug) then
    new_slug := new_slug || '-' || left(s.id::text, 6);
  end if;

  insert into public.cards (set_id, slug, name, number, rarity, image_url)
    values (new_set, new_slug, s.player, s.number, coalesce(nullif(s.variant, ''), 'Base'),
            'https://gnlgdawkdcwbhwvaijon.supabase.co/storage/v1/object/public/card-submissions/' || s.image_path)
    returning id into new_card;

  update public.card_submissions
    set status = 'approved', card_id = new_card, reviewed_at = now(), reviewed_by = auth.uid()
    where id = target;
  return new_slug;
end;
$$;
revoke execute on function public.review_card_submission(uuid, boolean, text) from public, anon;
grant execute on function public.review_card_submission(uuid, boolean, text) to authenticated;

-- Fotky návrhů: veřejný bucket (po schválení je to obrázek karty), nahrávat jen do vlastní složky.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-submissions', 'card-submissions', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "fotka návrhu do vlastní složky" on storage.objects for insert to authenticated
  with check (bucket_id = 'card-submissions' and (storage.foldername(name))[1] = auth.uid()::text);
