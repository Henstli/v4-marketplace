-- Přestavba podpory, zbývající část (části 1–4 už jsou v databázi). Spusťte celé najednou v Supabase › SQL Editor.
-- Varování o „destructive operations“ je kvůli odhlášení uživatele a vypnutí 2FA uvnitř funkcí, nic se teď nemaže.

create or replace function public.staff_guard_target(p_user uuid) returns void
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() or not public.mfa_ok() then raise exception 'Jen pro tým podpory'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Uživatel neexistuje'; end if;
  if exists (select 1 from public.admins where user_id = p_user) and not public.is_full_admin() then
    raise exception 'Účet člena týmu upravuje jen správce';
  end if;
end;
$$;
revoke execute on function public.staff_guard_target(uuid) from public, anon, authenticated;

-- Předplatné podle účtu (např. zaplatil a nedostal). Smí celá podpora.
create or replace function public.admin_user_plan(p_user uuid, p_plan text, p_note text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  perform public.staff_guard_target(p_user);
  if p_plan not in ('free', 'plus', 'pro') then raise exception 'Neznámý tarif'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Napište krátce proč'; end if;
  if p_plan = 'free' then
    delete from public.subscriptions where user_id = p_user;
  else
    insert into public.subscriptions (user_id, plan, granted_by, note)
      values (p_user, p_plan, auth.uid(), left(trim(p_note), 300))
      on conflict (user_id) do update set plan = excluded.plan, granted_by = excluded.granted_by, granted_at = now(), note = excluded.note;
  end if;
  insert into public.staff_actions (staff_id, user_id, action, detail)
    values (auth.uid(), p_user, 'plan', left('Tarif ' || p_plan || ' · ' || trim(p_note), 300));
end;
$$;
revoke execute on function public.admin_user_plan(uuid, text, text) from public, anon;
grant execute on function public.admin_user_plan(uuid, text, text) to authenticated;

-- Oprava údajů účtu: přezdívka, typ účtu, IČO.
create or replace function public.admin_user_profile(p_user uuid, p_name text, p_kind text, p_ico text, p_reason text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  old public.profiles;
  v_name text := trim(coalesce(p_name, ''));
  v_ico text := nullif(regexp_replace(coalesce(p_ico, ''), '\s', '', 'g'), '');
  changes text[] := '{}';
begin
  perform public.staff_guard_target(p_user);
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Napište krátce proč'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 40 then raise exception 'Přezdívka má 2 až 40 znaků'; end if;
  if p_kind not in ('private', 'shop') then raise exception 'Neznámý typ účtu'; end if;
  if v_ico is not null and v_ico !~ '^[0-9]{8}$' then raise exception 'IČO má 8 číslic'; end if;
  if p_kind = 'shop' and v_ico is null then raise exception 'Obchod potřebuje IČO'; end if;
  select * into old from public.profiles where id = p_user;
  if old.display_name is distinct from v_name then changes := changes || ('přezdívka ' || old.display_name || ' → ' || v_name); end if;
  if old.kind::text is distinct from p_kind then changes := changes || ('typ ' || case p_kind when 'shop' then 'Obchod' else 'Sběratel' end); end if;
  if old.ico is distinct from v_ico then changes := changes || ('IČO ' || coalesce(v_ico, 'odebráno')); end if;
  if cardinality(changes) = 0 then raise exception 'Nic se nezměnilo'; end if;
  update public.profiles set display_name = v_name, kind = p_kind::public.seller_kind, ico = v_ico where id = p_user;
  insert into public.staff_actions (staff_id, user_id, action, detail)
    values (auth.uid(), p_user, 'profile', left(array_to_string(changes, ', ') || ' · ' || trim(p_reason), 300));
end;
$$;
revoke execute on function public.admin_user_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_user_profile(uuid, text, text, text, text) to authenticated;

-- Odhlášení ze všech zařízení: zruší přihlášení a zapomene důvěryhodná zařízení (příště kód z e-mailu).
create or replace function public.admin_user_signout(p_user uuid, p_reason text) returns int
  language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  perform public.staff_guard_target(p_user);
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Napište krátce proč'; end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  delete from public.trusted_devices where user_id = p_user;
  insert into public.staff_actions (staff_id, user_id, action, detail)
    values (auth.uid(), p_user, 'signout', left('Odhlášeno ze všech zařízení (' || n || ') · ' || trim(p_reason), 300));
  return n;
end;
$$;
revoke execute on function public.admin_user_signout(uuid, text) from public, anon;
grant execute on function public.admin_user_signout(uuid, text) to authenticated;

-- Vypnutí dvoufázového ověření po ověření totožnosti (ztracený telefon).
create or replace function public.admin_user_mfa_reset(p_user uuid, p_reason text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  perform public.staff_guard_target(p_user);
  if exists (select 1 from public.admins where user_id = p_user) then raise exception 'Členovi týmu 2FA vypnout nejde'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Popište, jak jste ověřili totožnost'; end if;
  if not exists (select 1 from auth.mfa_factors where user_id = p_user) then raise exception 'Uživatel nemá dvoufázové ověření zapnuté'; end if;
  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  insert into public.staff_actions (staff_id, user_id, action, detail)
    values (auth.uid(), p_user, 'mfa_reset', left('Vypnuto dvoufázové ověření · ' || trim(p_reason), 300));
end;
$$;
revoke execute on function public.admin_user_mfa_reset(uuid, text) from public, anon;
grant execute on function public.admin_user_mfa_reset(uuid, text) to authenticated;

-- Zápis akcí, které provádí web (odkaz na heslo, nové potvrzení).
create or replace function public.admin_log_action(p_user uuid, p_action text, p_detail text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  perform public.staff_guard_target(p_user);
  if p_action not in ('password_reset', 'confirm_resend') then raise exception 'Neznámá akce'; end if;
  insert into public.staff_actions (staff_id, user_id, action, detail) values (auth.uid(), p_user, p_action, left(p_detail, 300));
end;
$$;
revoke execute on function public.admin_log_action(uuid, text, text) from public, anon;
grant execute on function public.admin_log_action(uuid, text, text) to authenticated;

-- Přihlášení uživatele: aktivní přihlášení s prohlížečem a zkrácenou IP, důvěryhodná zařízení.
create or replace function public.admin_user_sessions(p_user uuid)
returns table (kind text, created_at timestamptz, last_at timestamptz, agent text, ip text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Jen pro tým podpory'; end if;
  return query
    select 'session'::text, s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at), left(s.user_agent, 300),
      case when s.ip is null then null when family(s.ip) = 4 then regexp_replace(host(s.ip), '\.\d+$', '.×') else regexp_replace(host(s.ip), ':[^:]*$', ':×') end
    from auth.sessions s where s.user_id = p_user
    union all
    select 'device'::text, d.created_at, d.last_used_at, d.label, null::text
    from public.trusted_devices d where d.user_id = p_user
    order by 3 desc
    limit 50;
end;
$$;
revoke execute on function public.admin_user_sessions(uuid) from public, anon;
grant execute on function public.admin_user_sessions(uuid) to authenticated;

-- Objednávky uživatele (obě role) pro kartu Objednávky.
create or replace function public.admin_user_orders(p_user uuid)
returns table (id uuid, number bigint, role text, other_id uuid, other_name text, status text, total_czk int, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Jen pro tým podpory'; end if;
  return query
    select o.id, o.number, case when o.buyer_id = p_user then 'buyer' else 'seller' end,
      case when o.buyer_id = p_user then o.seller_id else o.buyer_id end, p.display_name, o.status::text, o.total_czk, o.created_at
    from public.orders o
    left join public.profiles p on p.id = case when o.buyer_id = p_user then o.seller_id else o.buyer_id end
    where p_user in (o.buyer_id, o.seller_id)
    order by o.created_at desc limit 100;
end;
$$;
revoke execute on function public.admin_user_orders(uuid) from public, anon;
grant execute on function public.admin_user_orders(uuid) to authenticated;

-- Nabídky uživatele včetně skrytých pro kartu Nabídky.
create or replace function public.admin_user_listings(p_user uuid)
returns table (id uuid, card text, slug text, set_code text, number text, price_czk int, quantity int, hidden_qty int, removed_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Jen pro tým podpory'; end if;
  return query
    select l.id, c.name, c.slug, s.code, c.number, l.price_czk, l.quantity, l.hidden_qty, l.removed_at, l.created_at
    from public.listings l join public.cards c on c.id = l.card_id left join public.card_sets s on s.id = c.set_id
    where l.seller_id = p_user
    order by (l.quantity > 0 or l.hidden_qty > 0) desc, l.created_at desc limit 200;
end;
$$;
revoke execute on function public.admin_user_listings(uuid) from public, anon;
grant execute on function public.admin_user_listings(uuid) to authenticated;

-- Skrytí nebo obnovení jedné nabídky.
create or replace function public.admin_listing_visibility(p_listing uuid, p_hide boolean, p_reason text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  l public.listings;
  v_card text;
begin
  select * into l from public.listings where id = p_listing for update;
  if l.id is null then raise exception 'Nabídka neexistuje'; end if;
  perform public.staff_guard_target(l.seller_id);
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Napište krátce proč'; end if;
  select name into v_card from public.cards where id = l.card_id;
  if p_hide then
    if l.hidden_qty is not null then raise exception 'Nabídka už je skrytá'; end if;
    update public.listings set hidden_qty = quantity, quantity = 0 where id = l.id;
  else
    if l.hidden_qty is null then raise exception 'Nabídka není skrytá'; end if;
    if public.account_restriction(l.seller_id) is not null then raise exception 'Účet je omezený, nejdřív zrušte omezení'; end if;
    update public.listings set quantity = quantity + hidden_qty, hidden_qty = null where id = l.id;
  end if;
  insert into public.staff_actions (staff_id, user_id, action, detail)
    values (auth.uid(), l.seller_id, case when p_hide then 'listing_hide' else 'listing_restore' end,
      left(coalesce(v_card, 'nabídka') || ' · ' || trim(p_reason), 300));
end;
$$;
revoke execute on function public.admin_listing_visibility(uuid, boolean, text) from public, anon;
grant execute on function public.admin_listing_visibility(uuid, boolean, text) to authenticated;

-- Zprávy mezi kupujícím a prodejcem objednávky z případu. Každé otevření se zapíše.
create or replace function public.admin_case_messages(p_case uuid)
returns table (id bigint, sender_id uuid, sender text, kind text, body text, created_at timestamptz, hidden_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  c public.support_cases;
  o public.orders;
  conv uuid;
begin
  if not public.is_admin() or not public.mfa_ok() then raise exception 'Jen pro tým podpory'; end if;
  select * into c from public.support_cases where support_cases.id = p_case;
  if c.id is null or c.order_id is null then raise exception 'Případ nemá objednávku'; end if;
  select * into o from public.orders where orders.id = c.order_id;
  select v.id into conv from public.conversations v
    where (v.user_a = o.buyer_id and v.user_b = o.seller_id) or (v.user_a = o.seller_id and v.user_b = o.buyer_id) limit 1;
  insert into public.staff_actions (staff_id, user_id, case_id, action, detail)
    values (auth.uid(), o.seller_id, c.id, 'messages_view', 'Zprávy k objednávce č. ' || o.number || ' · ' || public.case_code(c.number));
  insert into public.case_events (case_id, kind, author_id, body)
    values (c.id, 'event', auth.uid(), 'Otevřeny zprávy mezi stranami');
  if conv is null then return; end if;
  return query
    select m.id, m.sender_id, p.display_name, m.kind, m.body, m.created_at, m.hidden_at
    from public.messages m left join public.profiles p on p.id = m.sender_id
    where m.conversation_id = conv
    order by m.created_at desc limit 300;
end;
$$;
revoke execute on function public.admin_case_messages(uuid) from public, anon;
grant execute on function public.admin_case_messages(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Tým vidí celý tým, měnit smí jen správce
-- ---------------------------------------------------------------------------
create or replace function public.team_overview()
returns table (user_id uuid, display_name text, email text, role text, added_at timestamptz,
  case_number int, seen_at timestamptz, open_cases int, month_minutes numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_month timestamptz := (date_trunc('month', now() at time zone 'Europe/Prague')) at time zone 'Europe/Prague';
begin
  if not public.is_admin() then raise exception 'Jen pro tým podpory'; end if;
  return query
    select a.user_id, p.display_name, u.email::text, a.role, a.added_at,
      (select c.number from public.support_cases c where c.id = sp.case_id),
      sp.seen_at,
      (select count(*)::int from public.support_cases c where c.assignee_id = a.user_id and c.status <> 'resolved'),
      (select coalesce(sum(extract(epoch from (coalesce(t.ended_at, now()) - greatest(t.started_at, v_month))) / 60), 0)
         from public.case_time t where t.staff_id = a.user_id and coalesce(t.ended_at, now()) > v_month)
    from public.admins a
    join auth.users u on u.id = a.user_id
    left join public.profiles p on p.id = a.user_id
    left join public.support_presence sp on sp.staff_id = a.user_id
    order by a.role, p.display_name;
end;
$$;
revoke execute on function public.team_overview() from public, anon;
grant execute on function public.team_overview() to authenticated;

-- Opravu cizího času správcem zapíšeme do záznamu akcí.
create or replace function public.admin_fix_time(p_id bigint, p_minutes int) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  t public.case_time;
begin
  if not public.is_admin() or not public.mfa_ok() then raise exception 'Jen pro tým podpory'; end if;
  select * into t from public.case_time where id = p_id for update;
  if t.id is null then raise exception 'Záznam neexistuje'; end if;
  if t.staff_id <> auth.uid() and not public.is_full_admin() then raise exception 'Cizí čas opravuje jen správce'; end if;
  if p_minutes < 0 or p_minutes > 600 then raise exception 'Zadejte 0 až 600 minut'; end if;
  update public.case_time set ended_at = started_at + make_interval(mins => p_minutes), auto_stopped = false where id = t.id;
  insert into public.staff_actions (staff_id, user_id, case_id, action, detail)
    values (auth.uid(), t.staff_id, t.case_id, 'time_fix',
      'Čas ' || to_char(t.started_at at time zone 'Europe/Prague', 'FMDD. FMMM. HH24:MI') || ' opraven na ' || p_minutes || ' min');
end;
$$;
revoke execute on function public.admin_fix_time(bigint, int) from public, anon;
grant execute on function public.admin_fix_time(bigint, int) to authenticated;

-- Profil uživatele: potvrzený e-mail (Poslat znovu potvrzení) a kolikrát nahlásil sám.
create or replace function public.admin_user_info(p_user uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.is_admin() then raise exception 'Jen pro správce'; end if;
  select jsonb_build_object(
    'email', u.email,
    'confirmed', u.email_confirmed_at is not null,
    'created_at', u.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
    'plan', (select s.plan from public.subscriptions s where s.user_id = u.id),
    'verified', (select s.method from public.seller_verifications s where s.user_id = u.id),
    'sold', (select count(*) from public.orders o where o.seller_id = u.id and o.status = 'delivered'),
    'bought', (select count(*) from public.orders o where o.buyer_id = u.id and o.status = 'delivered'),
    'reviews', (select count(*) from public.reviews r where r.seller_id = u.id),
    'reviews_positive', (select count(*) from public.reviews r where r.seller_id = u.id and r.rating >= 4),
    'cancelled_after_paid', (select t.cancelled_after_paid from public.seller_trust(u.id) t),
    'disputes', (select t.disputes from public.seller_trust(u.id) t),
    'reports_against', (select count(*) from public.reports r where r.against_id = u.id),
    'content_against', (select count(*) from public.content_reports r where r.author_id = u.id and r.created_at > now() - interval '12 months'),
    'reported', (select count(*) from public.reports r where r.reporter_id = u.id)
              + (select count(*) from public.content_reports r where r.reporter_id = u.id),
    'listings', (select count(*) from public.listings l where l.seller_id = u.id and l.quantity > 0),
    'hidden', (select count(*) from public.listings l where l.seller_id = u.id and l.hidden_qty > 0),
    'restriction', (select jsonb_build_object('kind', r.kind, 'until', r.until, 'set_at', r.set_at)
      from public.account_restrictions r where r.user_id = u.id and r.ended_at is null)
  ) into v
  from auth.users u where u.id = p_user;
  return v;
end;
$$;
