-- Vzhled profilu (varianta Discord): výběr podložky celého profilu a skrytí odznaku věrnosti.
-- Nic se nemaže: jen dva nové sloupce s výchozí hodnotou.
alter table public.profiles
  add column if not exists profile_mat text not null default 'lava' check (profile_mat in ('lava', 'felt', 'night', 'leather')),
  add column if not exists loyalty_hidden boolean not null default false;
