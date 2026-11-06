-- Spuštěno ručně v SQL Editoru (6. 11.): smazání účtu smaže i pravidla Co hlídat a záznamy K prověření.
alter table public.stock_watch add constraint stock_watch_owner_fkey foreign key (owner_id) references public.profiles(id) on delete cascade;
alter table public.stock_flags add constraint stock_flags_owner_fkey foreign key (owner_id) references public.profiles(id) on delete cascade;
