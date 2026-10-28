-- Mazání po 3 letech (zásady ochrany OÚ): hlášení objednávek, případy podpory, nahlášení obsahu
-- a záznamy moderace. Spouští ho denní cron webu (service_role). Součty času podpory za staré
-- měsíce zůstanou bez osobních údajů. Soubory příloh v úložišti maže cron dřív (90 dní po vyřešení).

create table public.support_time_months (
  staff_id uuid not null,
  month date not null,
  minutes int not null default 0,
  primary key (staff_id, month)
);
alter table public.support_time_months enable row level security;
grant select on public.support_time_months to authenticated;
create policy "souhrny času čtou správci" on public.support_time_months for select to authenticated using (public.is_full_admin());

-- Záznam akcí a historie týmu nejde měnit; výjimkou je jen mazání po 3 letech níže.
create or replace function public.staff_actions_immutable() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('v4.retention', true) = 'on' then return old; end if;
  raise exception 'Záznam akcí nejde upravit ani smazat';
end;
$$;

create or replace function public.purge_support_records() returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_limit timestamptz := now() - interval '3 years';
  v_cases uuid[];
  v_reports uuid[];
  n_cases int;
  n_reports int;
  n_content int;
  n_actions int;
begin
  perform set_config('v4.retention', 'on', true);

  select coalesce(array_agg(id), '{}') into v_cases from public.support_cases
  where status = 'resolved' and resolved_at < v_limit;

  insert into public.support_time_months (staff_id, month, minutes)
  select t.staff_id, date_trunc('month', t.started_at)::date,
    round(sum(extract(epoch from (coalesce(t.ended_at, t.started_at) - t.started_at)) / 60))::int
  from public.case_time t where t.case_id = any(v_cases) and t.staff_id is not null
  group by 1, 2
  on conflict (staff_id, month) do update set minutes = public.support_time_months.minutes + excluded.minutes;

  delete from public.case_time where case_id = any(v_cases);
  delete from public.case_events where case_id = any(v_cases);
  delete from public.case_files where case_id = any(v_cases);
  update public.account_restrictions set case_id = null where case_id = any(v_cases);
  delete from public.content_reports where case_id = any(v_cases) or (case_id is null and created_at < v_limit);
  get diagnostics n_content = row_count;
  delete from public.support_cases where id = any(v_cases);
  get diagnostics n_cases = row_count;

  select coalesce(array_agg(id), '{}') into v_reports from public.reports where status = 'closed' and closed_at < v_limit;
  delete from public.report_files where report_id = any(v_reports);
  delete from public.reports where id = any(v_reports);
  get diagnostics n_reports = row_count;

  -- Moderace: skončená omezení a záznamy akcí po 3 letech; u trvale zrušeného účtu zůstávají.
  delete from public.account_restrictions where ended_at < v_limit;
  delete from public.staff_actions a where a.created_at < v_limit and not exists (
    select 1 from public.account_restrictions r where r.user_id = a.user_id and r.ended_at is null);
  get diagnostics n_actions = row_count;
  delete from public.team_log where created_at < v_limit;

  return jsonb_build_object('cases', n_cases, 'reports', n_reports, 'content', n_content, 'actions', n_actions);
end;
$$;
revoke execute on function public.purge_support_records() from public, anon, authenticated;
grant execute on function public.purge_support_records() to service_role;
