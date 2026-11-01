-- Přátelé: odmítnutí žádosti a odebrání z přátel (spustit v Supabase › SQL Editor).
-- Obsahuje DELETE uvnitř funkcí, proto ho konektor neumí spustit sám. Nic se tím nemaže hned,
-- jen se vytvoří dvě funkce, které smažou jedinou žádost nebo přátelství, když o to uživatel požádá.
create or replace function public.friend_respond(p_other uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Nepřihlášen' using errcode = '42501'; end if;
  if p_accept then
    update public.friendships set accepted_at = now() where requester = p_other and addressee = me and accepted_at is null;
  else
    delete from public.friendships where requester = p_other and addressee = me and accepted_at is null;
  end if;
  return public.friend_status(p_other);
end $$;

create or replace function public.friend_remove(p_other uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Nepřihlášen' using errcode = '42501'; end if;
  delete from public.friendships
    where (requester = me and addressee = p_other) or (requester = p_other and addressee = me);
  return 'none';
end $$;

grant execute on function public.friend_respond(uuid, boolean), public.friend_remove(uuid) to authenticated;
