-- Změna hesla: kdo heslo má, musí zadat současné. Výjimkou je obnova přes odkaz z e-mailu
-- (přihlášení odkazem z e-mailu v posledních 15 minutách) a účty bez hesla (Google).

create or replace function public.has_password() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce(u.encrypted_password, '') <> '' from auth.users u where u.id = auth.uid();
$$;

create or replace function public.recent_password_recovery() returns boolean
  language sql stable set search_path = '' as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a
    where a->>'method' in ('recovery', 'otp', 'magiclink')
      and (a->>'timestamp')::bigint > extract(epoch from now()) - 900
  );
$$;

-- Vrací null, když změnu povolit, jinak důvod: 'current_required' nebo 'current_wrong'.
create or replace function public.check_password_change(current_password text) returns text
  language plpgsql stable security definer set search_path = '' as $$
declare
  hash text;
begin
  if auth.uid() is null then return 'current_required'; end if;
  if public.recent_password_recovery() then return null; end if;
  select coalesce(encrypted_password, '') into hash from auth.users where id = auth.uid();
  if hash = '' then return null; end if;
  if coalesce(current_password, '') = '' then return 'current_required'; end if;
  if extensions.crypt(current_password, hash) <> hash then return 'current_wrong'; end if;
  return null;
end;
$$;

revoke execute on function public.has_password(), public.recent_password_recovery(), public.check_password_change(text) from public, anon;
grant execute on function public.has_password(), public.recent_password_recovery(), public.check_password_change(text) to authenticated;
