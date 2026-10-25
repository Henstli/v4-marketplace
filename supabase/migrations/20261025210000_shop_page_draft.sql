-- Rozpracovaný koncept stránky obchodu: editor ho průběžně ukládá, veřejná stránka se změní
-- až po „Zveřejnit změny“. Koncept vidí jen majitel. Jen přibývá tabulka, nic se nemaže.
create table if not exists public.shop_page_drafts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  -- Celé nastavení stránky ve tvaru ShopPageConfig (src/lib/shop-config.ts)
  draft jsonb not null check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) < 150000),
  updated_at timestamptz not null default now()
);
alter table public.shop_page_drafts enable row level security;
create policy "vlastní koncept čtení" on public.shop_page_drafts for select to authenticated using (auth.uid() = user_id);
create policy "vlastní koncept zápis" on public.shop_page_drafts for insert to authenticated with check (auth.uid() = user_id);
create policy "vlastní koncept úprava" on public.shop_page_drafts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "vlastní koncept zahození" on public.shop_page_drafts for delete to authenticated using (auth.uid() = user_id);
create policy "koncept po dvoufázovém ověření" on public.shop_page_drafts as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());
grant select, insert, update, delete on public.shop_page_drafts to authenticated;
