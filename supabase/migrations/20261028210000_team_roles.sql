-- Tým V4cards: role Správce (všechno) a Podpora (jen panel podpory a hlášení).
-- Tým má automaticky výhody tarifu Pro, ale v sekci Obchody Pro na úvodní stránce se neukazuje.
-- Nic se nemaže, jen přibývají sloupce, tabulka a funkce. Stávající správci zůstávají správci.

alter table public.admins
  add column role text not null default 'admin' check (role in ('admin', 'support')),
  add column added_at timestamptz not null default now(),
  add column added_by uuid references auth.users(id) on delete set null;

-- is_admin() od teď znamená „člen týmu“ (správce i podpora): hlídá panel podpory, hlášení a omezení účtů.
-- Věci jen pro správce (schvalování karet, předplatné, ověření, tým) hlídá is_full_admin().
create or replace function public.is_full_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'admin');
$$;
revoke execute on function public.is_full_admin() from public, anon;
grant execute on function public.is_full_admin() to authenticated;

-- Role přihlášeného: admin, support, nebo null (web podle ní ukazuje Správu a režim podpory).
create or replace function public.staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.admins where user_id = auth.uid();
$$;
revoke execute on function public.staff_role() from public, anon;
grant execute on function public.staff_role() to authenticated;

-- Historie změn týmu (kdo koho přidal, změnil, odebral). Nejde upravit ani smazat.
create table public.team_log (
  id bigint generated always as identity primary key,
  staff_id uuid,
  user_id uuid not null,
  old_role text,
  new_role text,
  created_at timestamptz not null default now()
);
alter table public.team_log enable row level security;
grant select on public.team_log to authenticated;
create policy "historii týmu čtou správci" on public.team_log for select to authenticated using (public.is_full_admin());
create trigger team_log_no_change before update or delete on public.team_log
  for each row execute function public.staff_actions_immutable();

-- Členové týmu pro stránku Tým.
create or replace function public.team_list()
returns table (user_id uuid, display_name text, email text, role text, added_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_full_admin() then raise exception 'Jen pro správce'; end if;
  return query
    select a.user_id, p.display_name, u.email::text, a.role, a.added_at
    from public.admins a
    join auth.users u on u.id = a.user_id
    left join public.profiles p on p.id = a.user_id
    order by a.role, a.added_at;
end;
$$;
revoke execute on function public.team_list() from public, anon;
grant execute on function public.team_list() to authenticated;

-- Tým má výhody Pro (bez řádku v předplatném, takže po odchodu z týmu se vrátí jeho vlastní tarif).
create or replace function public.current_plan() returns text
language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.admins where user_id = auth.uid()) then 'pro'
    else coalesce((select plan from public.subscriptions where user_id = auth.uid()), 'free') end;
$$;

create or replace function public.seller_plans(p_ids uuid[])
returns table (user_id uuid, plan text)
language sql stable security definer set search_path = '' as $$
  select x.id, case when a.user_id is not null then 'pro' else s.plan end
  from unnest(p_ids[1:200]) as x(id)
  left join public.subscriptions s on s.user_id = x.id
  left join public.admins a on a.user_id = x.id
  where s.user_id is not null or a.user_id is not null;
$$;

-- Obchody Pro na úvodní stránce bez členů týmu.
create or replace function public.pro_shops(p_limit int default 6)
returns table (user_id uuid, display_name text, kind text, slug text, tagline text, logo_path text, design jsonb, offers int)
language sql volatile security definer set search_path = '' as $$
  select p.id, p.display_name, p.kind::text, sp.slug, sp.tagline, sp.logo_path, sp.design,
         (select count(*)::int from public.listings l where l.seller_id = p.id and l.quantity > 0)
  from public.subscriptions s
  join public.shop_pages sp on sp.user_id = s.user_id and sp.published and sp.slug is not null
  join public.profiles p on p.id = s.user_id
  where s.plan = 'pro' and not exists (select 1 from public.admins a where a.user_id = s.user_id)
  order by random()
  limit least(greatest(p_limit, 1), 12);
$$;

-- Seznam předplatitelů jen pro správce.
create or replace function public.admin_list_subscriptions()
returns table (user_id uuid, display_name text, email text, plan text, granted_at timestamptz, note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_full_admin() then raise exception 'Jen pro správce'; end if;
  return query
    select s.user_id, p.display_name, u.email::text, s.plan, s.granted_at, s.note
    from public.subscriptions s
    join public.profiles p on p.id = s.user_id
    join auth.users u on u.id = s.user_id
    order by s.granted_at desc;
end;
$$;
