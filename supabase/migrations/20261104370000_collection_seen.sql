-- Kdy uživatel album naposledy otevřel: karty doplněné ze skladu po tomto čase se při otevření vloží s animací.
alter table public.collection_albums add column if not exists seen_at timestamptz;
grant update (seen_at) on public.collection_albums to authenticated;
update public.collection_albums set seen_at = now() where seen_at is null;
