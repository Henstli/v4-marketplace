-- Chat týmu (DS Support › Chat týmu): skupina „Celý tým“ a soukromé konverzace mezi kolegy.
-- Uživatelé ho nikdy nevidí. Místnost: 'team' nebo 'dm:<menší uuid>:<větší uuid>'.
-- Nic se nemaže: jen nové tabulky a funkce.

create table public.team_messages (
  id bigint generated always as identity primary key,
  room text not null check (room = 'team' or room ~ '^dm:[0-9a-f-]{36}:[0-9a-f-]{36}$'),
  sender_id uuid references public.profiles(id),
  -- text = zpráva člověka, system = předání případu a podobné řádky uprostřed
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text not null check (char_length(body) between 1 and 2000),
  case_id uuid references public.support_cases(id),
  created_at timestamptz not null default now()
);
create index team_messages_room_idx on public.team_messages (room, id desc);
alter table public.team_messages enable row level security;
grant select, insert on public.team_messages to authenticated;
create policy "chat týmu čte tým" on public.team_messages for select to authenticated
  using (public.is_admin() and (room = 'team' or position(auth.uid()::text in room) > 0));
create policy "do chatu týmu píše tým" on public.team_messages for insert to authenticated
  with check (public.is_admin() and public.mfa_ok() and sender_id = auth.uid()
    and (room = 'team' or position(auth.uid()::text in room) > 0));

create table public.team_reads (
  staff_id uuid not null,
  room text not null,
  read_at timestamptz not null default now(),
  primary key (staff_id, room)
);
alter table public.team_reads enable row level security;
grant select, insert, update on public.team_reads to authenticated;
create policy "svoje přečtení chatu" on public.team_reads for select to authenticated using (staff_id = auth.uid() and public.is_admin());
create policy "svoje přečtení chatu zapisuje" on public.team_reads for insert to authenticated with check (staff_id = auth.uid() and public.is_admin());
create policy "svoje přečtení chatu mění" on public.team_reads for update to authenticated
  using (staff_id = auth.uid()) with check (staff_id = auth.uid() and public.is_admin());

-- Místnosti s poslední zprávou a počtem nepřečtených (levý panel a číslo v menu).
create or replace function public.team_rooms()
returns table (room text, last_body text, last_kind text, last_sender uuid, last_at timestamptz, unread int)
language sql stable security invoker set search_path = '' as $$
  select m.room,
    (array_agg(m.body order by m.id desc))[1],
    (array_agg(m.kind order by m.id desc))[1],
    (array_agg(m.sender_id order by m.id desc))[1],
    max(m.created_at),
    (count(*) filter (where m.sender_id is distinct from auth.uid()
      and m.created_at > coalesce((select r.read_at from public.team_reads r where r.staff_id = auth.uid() and r.room = m.room), '-infinity'::timestamptz)))::int
  from public.team_messages m
  group by m.room;
$$;
revoke execute on function public.team_rooms() from public, anon;
grant execute on function public.team_rooms() to authenticated;
