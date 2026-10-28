-- Napsat podpoře (DS Support › Napsat podpoře): zpráva z formuláře /podpora sama založí případ ve frontě.
-- Nic se nemaže, přibývá sloupec, tabulka příloh, soukromý bucket a funkce.

alter table public.support_cases
  add column source text check (source in ('form', 'email'));

-- Přílohy případů (fotka nebo PDF z formuláře). Nahrává je web přes podepsaný odkaz, čte jen tým.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-files', 'support-files', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create table public.case_files (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id),
  path text not null unique,
  name text not null check (char_length(name) <= 120),
  size bigint,
  created_at timestamptz not null default now()
);
create index case_files_case_idx on public.case_files (case_id);
alter table public.case_files enable row level security;
grant select on public.case_files to authenticated;
create policy "přílohy případů čte tým" on public.case_files for select to authenticated using (public.is_admin());
create policy "přílohy případů čte tým" on storage.objects for select to authenticated
  using (bucket_id = 'support-files' and public.is_admin());

create or replace function public.support_topic_label(p_topic text) returns text
  language sql immutable set search_path = '' as $$
  select case p_topic
    when 'account' then 'Účet a přihlášení' when 'order' then 'Objednávka' when 'selling' then 'Prodávání'
    when 'plan' then 'Předplatné' when 'appeal' then 'Odvolání proti omezení' when 'other' then 'Jiné' end;
$$;

-- Zpráva z formuláře: přihlášený nevyplňuje jméno ani e-mail, nepřihlášený ano. Vrací číslo případu
-- a e-mail pro potvrzení. Nejvýš 5 zpráv za den na účet nebo e-mail.
create or replace function public.support_contact(p_topic text, p_body text, p_order int default null,
  p_name text default null, p_email text default null)
returns table (case_id uuid, number int, email text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_label text := public.support_topic_label(p_topic);
  v_body text := left(trim(coalesce(p_body, '')), 4000);
  v_email text;
  v_name text;
  v_order public.orders;
  v_other uuid;
  v_kind text := case when p_topic = 'appeal' then 'appeal' else 'question' end;
  v_short text;
  v_case public.support_cases;
begin
  if v_label is null then raise exception 'Vyberte téma'; end if;
  if char_length(v_body) < 10 then raise exception 'Napište zprávu (aspoň pár slov)'; end if;
  if v_uid is not null then
    select u.email::text into v_email from auth.users u where u.id = v_uid;
  else
    v_email := lower(trim(coalesce(p_email, '')));
    v_name := left(trim(coalesce(p_name, '')), 120);
    if char_length(v_name) < 2 then raise exception 'Napište své jméno'; end if;
    if char_length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Zadejte platný e-mail'; end if;
  end if;

  if (select count(*) from public.support_cases c
      where c.source = 'form' and c.created_at > now() - interval '1 day'
        and ((v_uid is not null and c.user_id = v_uid) or (v_uid is null and c.contact_email = v_email))) >= 5 then
    raise exception 'Dnes jste nám napsali už pětkrát. Odpovíme na předchozí zprávy, nebo pište na podpora@v4cards.com.';
  end if;

  if p_order is not null and v_uid is not null then
    select * into v_order from public.orders o where o.number = p_order and v_uid in (o.buyer_id, o.seller_id);
    if v_order.id is not null then
      v_other := case when v_order.buyer_id = v_uid then v_order.seller_id else v_order.buyer_id end;
    end if;
  end if;

  v_short := regexp_replace(v_body, '\s+', ' ', 'g');
  v_short := case when char_length(v_short) > 60 then left(v_short, 60) || '…' else v_short end;
  insert into public.support_cases (kind, subject, priority, due_at, user_id, other_id, contact_email, order_id, source)
  values (v_kind, left(v_label || ': ' || v_short, 200), 'mid', public.case_due(v_kind, 'mid'),
    v_uid, v_other, case when v_uid is null then v_email end, v_order.id, 'form')
  returning * into v_case;
  insert into public.case_events (case_id, kind, author_id, body)
  values (v_case.id, 'user', v_uid,
    v_label || coalesce(' · objednávka č. ' || v_order.number, '') || coalesce(' · ' || v_name || ' <' || v_email || '>', '')
    || E'\n\n' || v_body);

  return query select v_case.id, v_case.number, v_email;
end;
$$;
revoke execute on function public.support_contact(text, text, int, text, text) from public;
grant execute on function public.support_contact(text, text, int, text, text) to anon, authenticated;
