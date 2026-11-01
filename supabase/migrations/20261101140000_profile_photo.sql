-- Profilovka z jedné fotky (DS Trezor › ProfileCard › Profilovka, deska AV): banner na kartě a kruh všude v malém.
-- Jen přibývají sloupce. Fotka leží v bucketu shop-media ve složce uživatele (<uid>/avatar-…).
alter table public.profiles
  add column avatar_path text check (char_length(avatar_path) <= 200),
  add column avatar_crop jsonb;
