-- Tým, část 2: přidání a odebrání člena týmu a funkce jen pro správce (tarif, ověření, schvalování karet).

-- Přidat, změnit roli nebo odebrat (p_role = 'none'). Vlastní roli správce si nikdo nezmění,
-- aby web nezůstal bez správce. Vrací přezdívku.
create or replace function public.team_set_role(p_email text, p_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  old text;
begin
  if not public.is_full_admin() or not public.mfa_ok() then raise exception 'Tým spravuje jen správce'; end if;
  if p_role not in ('admin', 'support', 'none') then raise exception 'Neznámá role'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Uživatel s tímto e-mailem nemá účet na V4cards'; end if;
  if uid = auth.uid() then raise exception 'Svou vlastní roli změnit nemůžete'; end if;
  select role into old from public.admins where user_id = uid;
  if p_role = 'none' then
    if old is null then raise exception 'Uživatel není v týmu'; end if;
    delete from public.admins where user_id = uid;
  else
    if old = p_role then raise exception 'Uživatel už tuto roli má'; end if;
    insert into public.admins (user_id, role, added_by) values (uid, p_role, auth.uid())
      on conflict (user_id) do update set role = excluded.role;
  end if;
  insert into public.team_log (staff_id, user_id, old_role, new_role)
    values (auth.uid(), uid, old, nullif(p_role, 'none'));
  return coalesce((select display_name from public.profiles where id = uid), p_email);
end;
$$;
revoke execute on function public.team_set_role(text, text) from public, anon;
grant execute on function public.team_set_role(text, text) to authenticated;

-- Jen pro správce: předplatné, ověření prodejců, schvalování karet.
create or replace function public.admin_set_plan(p_email text, p_plan text, p_note text default null) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if not public.is_full_admin() or not public.mfa_ok() then
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
  if not public.is_full_admin() or not public.mfa_ok() then
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

create or replace function public.review_card_submission(target uuid, approve boolean, reason text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.card_submissions;
  set_title text;
  set_code text;
  new_set uuid;
  new_slug text;
  new_card uuid;
begin
  if not public.is_full_admin() then
    raise exception 'Schvalovat může jen správce';
  end if;
  if not public.mfa_ok() then
    raise exception 'Dokončete dvoufázové ověření';
  end if;
  select * into s from public.card_submissions where id = target for update;
  if not found then raise exception 'Návrh neexistuje'; end if;
  if s.status <> 'pending' then raise exception 'Návrh už je vyřízený'; end if;

  if not approve then
    update public.card_submissions
      set status = 'rejected', reject_reason = nullif(trim(reason), ''), reviewed_at = now(), reviewed_by = auth.uid()
      where id = target;
    return null;
  end if;

  set_title := concat_ws(' ', s.season, s.manufacturer, s.set_name);
  set_code := upper(left(regexp_replace(public.unaccent_immutable(set_title), '[^A-Za-z0-9]+', '', 'g'), 32));
  insert into public.card_sets (game_id, code, name)
    values (s.game_id, set_code, set_title)
    on conflict (game_id, code) do update set name = public.card_sets.name
    returning id into new_set;

  new_slug := trim(both '-' from lower(regexp_replace(
    public.unaccent_immutable(concat_ws('-', s.player, s.season, s.manufacturer, s.set_name, s.number, nullif(s.variant, ''))), '[^A-Za-z0-9]+', '-', 'g')));
  if exists (select 1 from public.cards where slug = new_slug) then
    new_slug := new_slug || '-' || left(s.id::text, 6);
  end if;

  insert into public.cards (set_id, slug, name, number, rarity, image_url)
    values (new_set, new_slug, s.player, s.number, coalesce(nullif(s.variant, ''), 'Base'),
            'https://gnlgdawkdcwbhwvaijon.supabase.co/storage/v1/object/public/card-submissions/' || s.image_path)
    returning id into new_card;

  update public.card_submissions
    set status = 'approved', card_id = new_card, reviewed_at = now(), reviewed_by = auth.uid()
    where id = target;
  return new_slug;
end;
$$;
