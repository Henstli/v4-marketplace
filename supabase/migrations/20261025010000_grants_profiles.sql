-- Projekt má vypnuté automatické zpřístupnění nových tabulek přes Data API,
-- takže práva roli anon a authenticated dáváme výslovně. Co kdo uvidí dál hlídá RLS.

grant usage on schema public to anon, authenticated;

grant select on games, card_sets, cards, price_history, profiles, listings, reviews to anon, authenticated;
grant update on profiles to authenticated;
grant insert, update, delete on listings to authenticated;
grant select on orders, order_items to authenticated;
grant insert on reviews to authenticated;

-- Nový uživatel dostane profil hned po registraci.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
