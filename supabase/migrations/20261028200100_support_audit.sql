-- Panel podpory, část 2: změny tarifu a ověření prodejce v záznamu akcí, záznam nejde měnit.

create or replace function public.staff_actions_immutable() returns trigger
  language plpgsql set search_path = '' as $$
begin
  raise exception 'Záznam akcí nejde upravit ani smazat';
end;
$$;
create trigger staff_actions_no_change before update or delete on public.staff_actions
  for each row execute function public.staff_actions_immutable();

-- Změna tarifu a ověření prodejce se zapisují do záznamu akcí.
create or replace function public.admin_set_plan(p_email text, p_plan text, p_note text default null) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if not public.is_admin() or not public.mfa_ok() then
    raise exception 'Předplatné přiděluje jen správce';
  end if;
  if p_plan not in ('free', 'plus', 'pro') then raise exception 'Neznámý tarif'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Uživatel s tímto e-mailem neexistuje'; end if;
  if p_plan = 'free' then
    delete from public.subscriptions where user_id = uid;
  else
    insert into public.subscriptions (user_id, plan, granted_by, note)
      values (uid, p_plan, auth.uid(), nullif(trim(p_note), ''))
      on conflict (user_id) do update
        set plan = excluded.plan, granted_by = excluded.granted_by, granted_at = now(),
            note = coalesce(excluded.note, public.subscriptions.note);
  end if;
  insert into public.staff_actions (staff_id, user_id, action, detail)
    values (auth.uid(), uid, 'plan', 'Tarif ' || p_plan || coalesce(' · ' || nullif(trim(p_note), ''), ''));
  return (select display_name from public.profiles where id = uid);
end;
$$;

create or replace function public.admin_set_verified(p_email text, p_method text, p_ico text default null) returns text
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
  insert into public.staff_actions (staff_id, user_id, action, detail)
    values (auth.uid(), uid, 'verify', case when p_method in ('identity', 'ico')
      then 'Ověřený prodejce · ' || case p_method when 'ico' then 'IČO ' || coalesce(p_ico, '') else 'totožnost' end
      else 'Ověření odebráno' end);
  return (select display_name from public.profiles where id = uid);
end;
$$;
