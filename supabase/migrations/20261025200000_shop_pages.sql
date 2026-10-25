-- Vlastní stránka obchodu a sběratele, ověření prodejce a obrázky stránek.
-- Nic se nemaže ani nepřepisuje, jen přibývají tabulky, funkce a bucket.

-- Stránka prodejce: vzhled a bloky. Co z nastavení se opravdu ukáže, určuje web podle tarifu
-- majitele (src/lib/plans.ts), takže po snížení tarifu se stránka sama zjednoduší a nic se neztratí.
create table public.shop_pages (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  -- Vlastní adresa v4cards.com/obchod/<slug> (Plus a Pro)
  slug text unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  published boolean not null default false,
  tagline text check (char_length(tagline) <= 160),
  about text check (char_length(about) <= 1500),
  -- Krátký vzkaz pod jménem u nabídek na detailu karty (Pro)
  offer_note text check (char_length(offer_note) <= 100),
  logo_path text check (char_length(logo_path) <= 200),
  banner_path text check (char_length(banner_path) <= 200),
  -- {color, mode, layout, font, corners, banner}
  design jsonb not null default '{}'::jsonb check (jsonb_typeof(design) = 'object'),
  -- [{id, type, enabled, variant, title, data}]
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 40),
  -- Vlastní kolekce skladu (uložené filtry), [{id, name, q, game, condition, language}]
  collections jsonb not null default '[]'::jsonb check (jsonb_typeof(collections) = 'array' and jsonb_array_length(collections) <= 20),
  -- {web, instagram, facebook, discord, email, phone}
  contact jsonb not null default '{}'::jsonb check (jsonb_typeof(contact) = 'object'),
  -- {address, pickup, hours: [{day, time}]}
  store jsonb not null default '{}'::jsonb check (jsonb_typeof(store) = 'object'),
  updated_at timestamptz not null default now(),
  check (pg_column_size(blocks) + pg_column_size(collections) + pg_column_size(contact) + pg_column_size(store) < 100000)
);
alter table public.shop_pages enable row level security;
create policy "stránky čte každý" on public.shop_pages for select using (true);
create policy "vlastní stránka zápis" on public.shop_pages for insert to authenticated with check (auth.uid() = user_id);
create policy "vlastní stránka úprava" on public.shop_pages for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "stránka po dvoufázovém ověření" on public.shop_pages as restrictive for insert to authenticated with check (public.mfa_ok());
create policy "úprava stránky po dvoufázovém ověření" on public.shop_pages as restrictive for update to authenticated using (public.mfa_ok());
grant select on public.shop_pages to anon, authenticated;
grant insert, update on public.shop_pages to authenticated;

-- Ověření prodejce (totožnost nebo IČO), zapisuje jen správce. Odznak „Ověřený prodejce“
-- ukáže web jen u placeného tarifu a s dobrým hodnocením.
create table public.seller_verifications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  method text not null check (method in ('identity', 'ico')),
  ico text check (ico ~ '^[0-9]{8}$'),
  verified_at timestamptz not null default now(),
  verified_by uuid references auth.users(id) on delete set null
);
alter table public.seller_verifications enable row level security;
create policy "ověření čte každý" on public.seller_verifications for select using (true);
grant select on public.seller_verifications to anon, authenticated;

create or replace function public.admin_set_verified(p_email text, p_method text, p_ico text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if not public.is_admin() or not public.mfa_ok() then
    raise exception 'Ověření nastavuje jen správce';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Uživatel s tímto e-mailem neexistuje'; end if;
  if p_method is null or p_method = 'none' then
    delete from public.seller_verifications where user_id = uid;
  elsif p_method in ('identity', 'ico') then
    insert into public.seller_verifications (user_id, method, ico, verified_by)
      values (uid, p_method, nullif(regexp_replace(coalesce(p_ico, ''), '\s', '', 'g'), ''), auth.uid())
      on conflict (user_id) do update
        set method = excluded.method, ico = excluded.ico, verified_by = excluded.verified_by, verified_at = now();
  else
    raise exception 'Neznámý způsob ověření';
  end if;
  return (select display_name from public.profiles where id = uid);
end;
$$;
revoke execute on function public.admin_set_verified(text, text, text) from public, anon;
grant execute on function public.admin_set_verified(text, text, text) to authenticated;

-- Tarify prodejců pro veřejné stránky (štítek PRO, vlastní stránka). Tabulka subscriptions
-- zůstává soukromá, ven jde jen kód tarifu.
create or replace function public.seller_plans(p_ids uuid[])
returns table (user_id uuid, plan text)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.plan from public.subscriptions s where s.user_id = any(p_ids[1:200]);
$$;
revoke execute on function public.seller_plans(uuid[]) from public;
grant execute on function public.seller_plans(uuid[]) to anon, authenticated;

-- Obchody Pro s publikovanou stránkou pro úvodní stránku (pořadí se střídá).
create or replace function public.pro_shops(p_limit int default 6)
returns table (user_id uuid, display_name text, kind text, slug text, tagline text, logo_path text, design jsonb, offers int)
language sql volatile security definer set search_path = '' as $$
  select p.id, p.display_name, p.kind::text, sp.slug, sp.tagline, sp.logo_path, sp.design,
         (select count(*)::int from public.listings l where l.seller_id = p.id and l.quantity > 0)
  from public.subscriptions s
  join public.shop_pages sp on sp.user_id = s.user_id and sp.published and sp.slug is not null
  join public.profiles p on p.id = s.user_id
  where s.plan = 'pro'
  order by random()
  limit least(greatest(p_limit, 1), 12);
$$;
revoke execute on function public.pro_shops(int) from public;
grant execute on function public.pro_shops(int) to anon, authenticated;

-- Počet karet v nabídce prodejce podle hry (blok „Kolekce podle hry“).
create or replace function public.seller_game_counts(p_seller uuid)
returns table (game_id text, cards int)
language sql stable security invoker set search_path = '' as $$
  select s.game_id, count(distinct l.card_id)::int
  from public.listings l
  join public.cards c on c.id = l.card_id
  join public.card_sets s on s.id = c.set_id
  where l.seller_id = p_seller and l.quantity > 0
  group by s.game_id;
$$;
grant execute on function public.seller_game_counts(uuid) to anon, authenticated;

-- Obrázky stránek (logo, banner, fotky prodejny): veřejný bucket, každý jen do své složky.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-media', 'shop-media', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "obrázek stránky do vlastní složky" on storage.objects for insert to authenticated
  with check (bucket_id = 'shop-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "obrázek stránky vidět ve vlastní složce" on storage.objects for select to authenticated
  using (bucket_id = 'shop-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "obrázek stránky smazat ve vlastní složce" on storage.objects for delete to authenticated
  using (bucket_id = 'shop-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "obrázek stránky po dvoufázovém ověření" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'shop-media' or public.mfa_ok());
