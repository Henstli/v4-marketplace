-- Přestavba panelu podpory (Šimon 28. 10., DS Support, plátno obrazovky 5–12):
-- čas se počítá sám, kdo je v případu, nová odpověď, odložit, sloučit, hotové odpovědi,
-- akce s účtem pro celou podporu, interní poznámka k uživateli, výkaz a tým pro všechny.
-- Nic se nemaže: přibývají sloupce, tabulky a funkce.

-- ---------------------------------------------------------------------------
-- 1. Čas se počítá sám
-- ---------------------------------------------------------------------------
-- case_id prázdný = Ostatní práce (fronta, hledání). last_beat = poslední aktivita v panelu.
alter table public.case_time alter column case_id drop not null;
alter table public.case_time add column last_beat timestamptz;

-- Cizí záznam opraví jen správce.
create policy "cizí čas opravuje správce" on public.case_time for update to authenticated
  using (public.is_full_admin()) with check (public.is_full_admin() and public.mfa_ok());

-- Kdo má právě otevřený který případ (a jestli píše).
create table public.support_presence (
  staff_id uuid primary key,
  case_id uuid references public.support_cases(id),
  typing boolean not null default false,
  seen_at timestamptz not null default now()
);
alter table public.support_presence enable row level security;
grant select on public.support_presence to authenticated;
create policy "přítomnost vidí tým" on public.support_presence for select to authenticated using (public.is_admin());

-- Signál z panelu každou minutu. Aktivní = pohyb myší nebo psaní v posledních 5 minutách.
-- Záznam bez aktivity déle než 5 minut se uzavře k poslední aktivitě.
create or replace function public.support_beat(p_case uuid, p_active boolean, p_typing boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.case_time;
  v_day timestamptz := (date_trunc('day', now() at time zone 'Europe/Prague')) at time zone 'Europe/Prague';
begin
  if not public.is_admin() or not public.mfa_ok() then raise exception 'Jen pro tým podpory'; end if;
  if p_case is not null and not exists (select 1 from public.support_cases where id = p_case) then p_case := null; end if;

  insert into public.support_presence (staff_id, case_id, typing, seen_at)
    values (me, p_case, coalesce(p_typing, false), now())
    on conflict (staff_id) do update set case_id = excluded.case_id, typing = excluded.typing, seen_at = now();

  select * into r from public.case_time where staff_id = me and ended_at is null;
  if r.id is not null and (r.case_id is distinct from p_case or not p_active
      or coalesce(r.last_beat, r.started_at) < now() - interval '5 minutes') then
    update public.case_time
      set ended_at = case when p_active and r.case_id is distinct from p_case
                            and coalesce(r.last_beat, r.started_at) >= now() - interval '5 minutes'
                          then now() else greatest(r.started_at, coalesce(r.last_beat, r.started_at)) end
      where id = r.id;
    r := null;
  end if;
  if p_active then
    if r.id is null then
      insert into public.case_time (case_id, staff_id, started_at, last_beat) values (p_case, me, now(), now());
    else
      update public.case_time set last_beat = now() where id = r.id;
    end if;
  end if;

  return jsonb_build_object(
    'today', (select coalesce(sum(extract(epoch from (coalesce(t.ended_at, now()) - greatest(t.started_at, v_day))) / 60), 0)
              from public.case_time t where t.staff_id = me and coalesce(t.ended_at, now()) > v_day),
    'mine', (select coalesce(sum(extract(epoch from (coalesce(t.ended_at, now()) - t.started_at)) / 60), 0)
             from public.case_time t where t.staff_id = me and p_case is not null and t.case_id = p_case),
    'total', (select coalesce(sum(extract(epoch from (coalesce(t.ended_at, now()) - t.started_at)) / 60), 0)
              from public.case_time t where p_case is not null and t.case_id = p_case),
    'here', (select coalesce(jsonb_agg(jsonb_build_object('id', p.staff_id, 'name', pr.display_name, 'typing', p.typing)
                     order by pr.display_name), '[]'::jsonb)
             from public.support_presence p join public.profiles pr on pr.id = p.staff_id
             where p_case is not null and p.case_id = p_case and p.seen_at > now() - interval '2 minutes')
  );
end;
$$;
revoke execute on function public.support_beat(uuid, boolean, boolean) from public, anon;
grant execute on function public.support_beat(uuid, boolean, boolean) to authenticated;

-- Uzavření záznamů, ze kterých přestaly chodit signály (zavřené okno, uspaný počítač).
create or replace function public.support_time_close() returns void
  language sql security definer set search_path = '' as $$
  update public.case_time set ended_at = greatest(started_at, last_beat)
    where ended_at is null and last_beat is not null and last_beat < now() - interval '5 minutes';
  update public.support_presence set case_id = null, typing = false
    where case_id is not null and seen_at < now() - interval '10 minutes';
$$;
revoke execute on function public.support_time_close() from public, anon, authenticated;
select cron.schedule('support-time-close', '*/5 * * * *', $$select public.support_time_close()$$);

-- ---------------------------------------------------------------------------
-- 2. Fronta: nová odpověď, odložené, sloučené
-- ---------------------------------------------------------------------------
alter table public.support_cases
  add column snoozed_until timestamptz,
  add column merged_into uuid references public.support_cases(id),
  add column last_user_at timestamptz;

update public.support_cases c set last_user_at = (select max(e.created_at) from public.case_events e where e.case_id = c.id and e.kind = 'user');

create or replace function public.case_event_touch() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  update public.support_cases
  set last_event = left(case new.kind when 'note' then 'Poznámka: ' when 'email' then 'E-mail: ' else '' end
        || regexp_replace(new.body, '\s+', ' ', 'g'), 140),
      last_user_at = case when new.kind = 'user' then new.created_at else last_user_at end,
      -- odpověď uživatele vrací odložený případ do fronty
      snoozed_until = case when new.kind = 'user' then null else snoozed_until end,
      updated_at = now()
  where id = new.case_id;
  return new;
end;
$$;

-- Kdy kdo z týmu případ naposledy otevřel (štítek Nová odpověď ve frontě).
create table public.case_reads (
  staff_id uuid not null,
  case_id uuid not null references public.support_cases(id),
  read_at timestamptz not null default now(),
  primary key (staff_id, case_id)
);
alter table public.case_reads enable row level security;
grant select, insert, update on public.case_reads to authenticated;
create policy "svoje přečtení" on public.case_reads for select to authenticated using (staff_id = auth.uid() and public.is_admin());
create policy "svoje přečtení zapisuje" on public.case_reads for insert to authenticated with check (staff_id = auth.uid() and public.is_admin());
create policy "svoje přečtení mění" on public.case_reads for update to authenticated
  using (staff_id = auth.uid()) with check (staff_id = auth.uid() and public.is_admin());

-- Sloučení: osa, přílohy a nahlášení se přesunou do cílového případu, původní se vyřeší s odkazem.
create or replace function public.admin_merge_cases(p_from uuid, p_into uuid) returns int
  language plpgsql security definer set search_path = '' as $$
declare
  a public.support_cases;
  b public.support_cases;
begin
  if not public.is_admin() or not public.mfa_ok() then raise exception 'Jen pro tým podpory'; end if;
  select * into a from public.support_cases where id = p_from for update;
  select * into b from public.support_cases where id = p_into for update;
  if a.id is null or b.id is null then raise exception 'Případ neexistuje'; end if;
  if a.id = b.id then raise exception 'Případ nejde sloučit sám se sebou'; end if;
  if a.report_id is not null then raise exception 'Případ s hlášením objednávky nejde sloučit do jiného, slučte opačně'; end if;
  if b.merged_into is not null then raise exception 'Cílový případ už je sloučený do jiného'; end if;
  update public.case_events set case_id = b.id where case_id = a.id;
  update public.case_files set case_id = b.id where case_id = a.id;
  update public.content_reports set case_id = b.id where case_id = a.id;
  update public.support_cases set
    user_id = coalesce(b.user_id, a.user_id), other_id = coalesce(b.other_id, a.other_id),
    contact_email = coalesce(b.contact_email, a.contact_email), order_id = coalesce(b.order_id, a.order_id),
    last_user_at = greatest(b.last_user_at, a.last_user_at)
    where id = b.id;
  update public.support_cases set status = 'resolved', resolved_at = now(), merged_into = b.id, snoozed_until = null where id = a.id;
  insert into public.case_events (case_id, kind, author_id, body)
    values (b.id, 'event', auth.uid(), 'Sloučeno s ' || public.case_code(a.number) || ' (' || a.subject || ')'),
           (a.id, 'event', auth.uid(), 'Sloučeno do ' || public.case_code(b.number));
  return b.number;
end;
$$;
revoke execute on function public.admin_merge_cases(uuid, uuid) from public, anon;
grant execute on function public.admin_merge_cases(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Hotové odpovědi: používá celý tým, upravuje správce
-- ---------------------------------------------------------------------------
create table public.support_templates (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 2 and 80),
  body text not null check (char_length(body) between 10 and 4000),
  sort int not null default 100,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.support_templates enable row level security;
grant select, insert, update, delete on public.support_templates to authenticated;
create policy "hotové odpovědi čte tým" on public.support_templates for select to authenticated using (public.is_admin());
create policy "hotové odpovědi přidává správce" on public.support_templates for insert to authenticated
  with check (public.is_full_admin() and public.mfa_ok());
create policy "hotové odpovědi mění správce" on public.support_templates for update to authenticated
  using (public.is_full_admin()) with check (public.is_full_admin() and public.mfa_ok());
create policy "hotové odpovědi maže správce" on public.support_templates for delete to authenticated
  using (public.is_full_admin() and public.mfa_ok());

insert into public.support_templates (label, body, sort) values
  ('Potvrzení přijetí', E'Dobrý den,\n\nděkujeme za zprávu. Případ jsme převzali a ozveme se vám nejpozději do 2 dnů.', 10),
  ('Jak nahlásit problém u objednávky', E'Dobrý den,\n\nu objednávky č. [číslo] klikněte na „Nahlásit problém“ a vyberte, co se stalo. Druhá strana pak má 3 dny na odpověď, a když se nedohodnete, převezmeme to my.', 20),
  ('Ozvali jsme se prodejci', E'Dobrý den,\n\nnapsali jsme prodejci a čekáme na jeho odpověď, nejdéle do [datum]. Jakmile se ozve, dáme vám vědět.', 30),
  ('Prosba o doklad platby', E'Dobrý den,\n\npro posouzení potřebujeme doklad o platbě (výpis nebo potvrzení z banky, PayPalu či Revolutu) s datem, částkou a příjemcem. Ostatní platby na výpisu prosím zakryjte. Doklad přiložte v Můj profil › Hlášení, nebo ho pošlete odpovědí na tuto zprávu.', 40),
  ('Platba doložena, výzva prodejci', E'Dobrý den,\n\nkupující u objednávky č. [číslo] doložil platbu [částka] Kč ze dne [datum]. Prosíme, zkontrolujte svůj účet a buď kartu odešlete, nebo peníze kupujícímu vraťte. Odpovězte nám prosím do [datum].\n\nV4cards peníze nepřijímá ani nevrací, platba šla přímo vám. Pokud se neozvete, můžeme podle čl. 13 obchodních podmínek omezit váš účet.', 50),
  ('Doporučení: reklamace u banky', E'Dobrý den,\n\nprodejce se k vaší platbě nevyjádřil. V4cards peníze nedrží, a proto je nemůže vrátit. Doporučujeme obrátit se na svou banku (u karetní platby reklamace, u PayPalu spor v Centru řešení). Podklady z hlášení vám rádi pošleme.', 60),
  ('Doporučení: trestní oznámení', E'Dobrý den,\n\npokud máte za to, že šlo o podvod, můžete podat trestní oznámení na kterékoli služebně Policie ČR. Vezměte s sebou doklad o platbě a číslo objednávky. Na žádost policie jí předáme údaje, které o objednávce máme.', 70),
  ('Nezávazné doporučení k dohodě', E'Dobrý den,\n\nprošli jsme podklady obou stran. Naše nezávazné doporučení: [doporučení]. Rozhodnutí je na vás a prodejci, V4cards spor nerozhoduje a peníze nedrží.', 80),
  ('Uzavření případu', E'Dobrý den,\n\npřípad uzavíráme. Kdybyste cokoli potřebovali, stačí odpovědět na tuto zprávu.', 90);

-- ---------------------------------------------------------------------------
-- 4. Uživatel: interní poznámka a akce s účtem (smí celá podpora)
-- ---------------------------------------------------------------------------
create table public.user_notes (
  user_id uuid primary key,
  body text not null check (char_length(body) <= 2000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.user_notes enable row level security;
grant select, insert, update on public.user_notes to authenticated;
create policy "poznámky k uživatelům čte tým" on public.user_notes for select to authenticated using (public.is_admin());
create policy "poznámky k uživatelům píše tým" on public.user_notes for insert to authenticated
  with check (public.is_admin() and public.mfa_ok() and updated_by = auth.uid());
create policy "poznámky k uživatelům mění tým" on public.user_notes for update to authenticated
  using (public.is_admin()) with check (public.is_admin() and public.mfa_ok() and updated_by = auth.uid());

alter table public.staff_actions drop constraint staff_actions_action_check;
alter table public.staff_actions add constraint staff_actions_action_check check (action in (
  'warning', 'hide_listings', 'suspend', 'ban', 'lift', 'expired', 'plan', 'verify',
  'profile', 'signout', 'mfa_reset', 'password_reset', 'confirm_resend', 'listing_hide', 'listing_restore',
  'messages_view', 'time_fix'));

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
