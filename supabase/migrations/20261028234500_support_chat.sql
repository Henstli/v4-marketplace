-- Chat s podporou v bublině (DS Support › Chat s podporou): uživatel vidí své dotazy, odpovědi podpory
-- a může psát dál. Odpovědi chodí do aplikace, e-mail jen když je do 30 minut nepřečte (nebo si zvolí e-mail).
-- Nic se nemaže: nové sloupce, tabulky a funkce.

-- Kudy posílat odpovědi podpory: app = v aplikaci (e-mail po 30 minutách nepřečtení), email = hned e-mailem.
alter table public.profiles add column support_reply_via text not null default 'app'
  check (support_reply_via in ('app', 'email'));

create or replace function public.set_support_reply_via(p_via text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Přihlaste se'; end if;
  if p_via not in ('app', 'email') then raise exception 'Neznámá volba'; end if;
  update public.profiles set support_reply_via = p_via where id = auth.uid();
end;
$$;
revoke execute on function public.set_support_reply_via(text) from public, anon;
grant execute on function public.set_support_reply_via(text) to authenticated;

-- Komu odpověď podpory patří (uživatel ji uvidí v chatu jen, když je mezi adresáty).
alter table public.case_events add column audience uuid[];

-- Kdy uživatel naposledy otevřel konverzaci (nepřečtené odpovědi a e-mail po 30 minutách).
create table public.case_user_reads (
  user_id uuid not null,
  case_id uuid not null references public.support_cases(id),
  read_at timestamptz not null default now(),
  primary key (user_id, case_id)
);
alter table public.case_user_reads enable row level security;

-- Odpovědi čekající na e-mail, když je uživatel do 30 minut v aplikaci nepřečte (cron /api/cron/podpora).
create table public.support_mail_queue (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.case_events(id),
  case_id uuid not null references public.support_cases(id),
  user_id uuid not null,
  subject text not null,
  send_after timestamptz not null,
  sent_at timestamptz,
  skipped boolean not null default false
);
create index support_mail_queue_due_idx on public.support_mail_queue (send_after) where sent_at is null;
alter table public.support_mail_queue enable row level security;
grant insert on public.support_mail_queue to authenticated;
create policy "frontu e-mailů plní tým" on public.support_mail_queue for insert to authenticated
  with check (public.is_admin() and public.mfa_ok());

-- Moje dotazy: předmět, stav, nepřečtené odpovědi.
create or replace function public.my_support_cases()
returns table (number int, subject text, status text, unread int, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.number, c.subject, c.status::text,
    (select count(*)::int from public.case_events e
      where e.case_id = c.id and e.kind = 'email' and auth.uid() = any(e.audience)
        and e.created_at > coalesce((select r.read_at from public.case_user_reads r where r.user_id = auth.uid() and r.case_id = c.id), '-infinity'::timestamptz)),
    greatest(c.created_at, (select max(e.created_at) from public.case_events e
      where e.case_id = c.id and ((e.kind = 'user' and e.author_id = auth.uid()) or (e.kind = 'email' and auth.uid() = any(e.audience)))))
  from public.support_cases c
  where auth.uid() is not null and auth.uid() in (c.user_id, c.other_id) and c.merged_into is null
    and (c.status <> 'resolved' or c.resolved_at > now() - interval '90 days')
  order by 5 desc
  limit 30;
$$;
revoke execute on function public.my_support_cases() from public, anon;
grant execute on function public.my_support_cases() to authenticated;

-- Konverzace jednoho dotazu: moje zprávy a odpovědi podpory pro mě. Otevření = přečteno.
create or replace function public.my_case_thread(p_number int) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  c public.support_cases;
  me uuid := auth.uid();
begin
  select * into c from public.support_cases where support_cases.number = p_number;
  if c.id is null or me is null or me not in (coalesce(c.user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(c.other_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'Dotaz neexistuje';
  end if;
  insert into public.case_user_reads (user_id, case_id, read_at) values (me, c.id, now())
    on conflict (user_id, case_id) do update set read_at = now();
  return jsonb_build_object(
    'number', c.number, 'subject', c.subject, 'status', c.status,
    'typing', exists (select 1 from public.support_presence p where p.case_id = c.id and p.typing and p.seen_at > now() - interval '2 minutes'),
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'mine', e.kind = 'user', 'body', e.body, 'at', e.created_at,
        'author', case when e.kind = 'user' then null else split_part(coalesce(p.display_name, 'Tým'), ' ', 1) end
      ) order by e.created_at)
      from public.case_events e left join public.profiles p on p.id = e.author_id
      where e.case_id = c.id and ((e.kind = 'user' and e.author_id = me) or (e.kind = 'email' and me = any(e.audience)))), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.my_case_thread(int) from public, anon;
grant execute on function public.my_case_thread(int) to authenticated;

-- Napsat do dotazu. Vyřešený nebo čekající dotaz se vrátí podpoře s novým termínem.
create or replace function public.my_case_post(p_number int, p_body text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  c public.support_cases;
  me uuid := auth.uid();
  v_body text := trim(coalesce(p_body, ''));
begin
  select * into c from public.support_cases where support_cases.number = p_number for update;
  if c.id is null or me is null or me not in (coalesce(c.user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(c.other_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'Dotaz neexistuje';
  end if;
  if c.merged_into is not null then raise exception 'Tento dotaz jsme spojili s jiným, pište prosím tam'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then raise exception 'Zpráva má 1 až 4000 znaků'; end if;
  if (select count(*) from public.case_events e where e.author_id = me and e.kind = 'user' and e.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Napsali jste toho hodně najednou, chvíli počkejte';
  end if;
  insert into public.case_events (case_id, kind, author_id, body) values (c.id, 'user', me, v_body);
  if c.status <> 'open' then
    update public.support_cases set status = 'open', resolved_at = null, due_at = public.case_due(c.kind::text, c.priority::text)
      where id = c.id;
  end if;
  insert into public.case_user_reads (user_id, case_id, read_at) values (me, c.id, now())
    on conflict (user_id, case_id) do update set read_at = now();
end;
$$;
revoke execute on function public.my_case_post(int, text) from public, anon;
grant execute on function public.my_case_post(int, text) to authenticated;
