-- Ochrana kupujícího, hlášení a spory (Šimon 28. 10., DS Reports).
-- V4cards spor zprostředkuje, ale nerozhoduje ho a peníze nikdy nedrží: kompenzace jde přímo od prodejce kupujícímu.

-- ---------------------------------------------------------------------------
-- 1. Platba odešla a čekání na zrušení
-- ---------------------------------------------------------------------------
alter table public.orders
  add column not_received_at timestamptz,
  add column buyer_insist_at timestamptz,
  add column cancel_request_at timestamptz,
  add column cancel_agreed boolean not null default false,
  add column delivered_at timestamptz;

-- Odkdy smí prodejce zrušit objednávku, kterou kupující označil jako zaplacenou.
-- Bez Zaplaceno hned (null), před Nepřišla nikdy, potom převod 3 dny a PayPal a Revolut 1 den od poslední reakce.
create or replace function public.order_cancel_from(o public.orders) returns timestamptz
  language sql immutable set search_path = '' as $$
  select case
    when o.buyer_paid_at is null then null
    when o.not_received_at is null then 'infinity'::timestamptz
    else coalesce(o.buyer_insist_at, o.not_received_at)
      + case when o.paid_via in ('paypal', 'revolut') then interval '1 day' else interval '3 days' end
  end;
$$;
grant execute on function public.order_cancel_from(public.orders) to authenticated;

-- Nepřišla: Zaplaceno zůstává, kupující buď potvrdí odeslání, nebo řekne, že ještě neplatil.
create or replace function public.payment_not_received(target uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.seller_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or o.buyer_paid_at is null or o.not_received_at is not null then
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
  update public.orders set not_received_at = now() where id = target;
  perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.seller_id, 'status',
    'Prodejce zatím nevidí platbu za objednávku č. ' || o.number, o.id);
end;
$$;

-- Kupující po Nepřišla: Platba odešla (p_sent), nebo Ještě jsem nezaplatil(a).
create or replace function public.answer_not_received(target uuid, p_sent boolean) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.buyer_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or o.not_received_at is null then raise exception 'Tuto změnu stavu nelze provést'; end if;
  if p_sent then
    if o.buyer_insist_at is not null then return; end if;
    update public.orders set buyer_insist_at = now() where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
      'Kupující potvrdil, že platba za objednávku č. ' || o.number || ' odešla', o.id);
  else
    update public.orders set buyer_paid_at = null, paid_via = null, not_received_at = null,
      buyer_insist_at = null, cancel_request_at = null where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
      'Kupující ještě nezaplatil objednávku č. ' || o.number, o.id);
  end if;
end;
$$;
revoke execute on function public.answer_not_received(uuid, boolean) from public, anon;
grant execute on function public.answer_not_received(uuid, boolean) to authenticated;

-- Prodejce požádá kupujícího o zrušení (dřív, než uplyne čekání).
create or replace function public.request_order_cancel(target uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.seller_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or o.buyer_paid_at is null or o.cancel_request_at is not null then
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
  update public.orders set cancel_request_at = now() where id = target;
  perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.seller_id, 'status',
    'Prodejce žádá o zrušení objednávky č. ' || o.number, o.id);
end;
$$;
revoke execute on function public.request_order_cancel(uuid) from public, anon;
grant execute on function public.request_order_cancel(uuid) to authenticated;

-- Kupující na žádost o zrušení: Souhlasím (zrušení se nepočítá prodejci) / Nesouhlasím.
create or replace function public.answer_cancel_request(target uuid, p_accept boolean) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.buyer_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or o.cancel_request_at is null then raise exception 'Tuto změnu stavu nelze provést'; end if;
  if p_accept then
    -- řádek do chatu napíše order_chat_event
    update public.orders set status = 'cancelled', cancel_agreed = true, cancel_request_at = null where id = target;
    perform public.release_order_items(target);
  else
    update public.orders set cancel_request_at = null where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
      'Kupující nesouhlasí se zrušením objednávky č. ' || o.number, o.id);
  end if;
end;
$$;
revoke execute on function public.answer_cancel_request(uuid, boolean) from public, anon;
grant execute on function public.answer_cancel_request(uuid, boolean) to authenticated;

-- Zrušení po Zaplaceno až po čekání; převzetí si pamatuje čas (lhůta na hlášení).
create or replace function public.set_order_status(target uuid, next_status public.order_status) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  me uuid := auth.uid();
  pay text;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found then raise exception 'Objednávka neexistuje'; end if;
  pay := coalesce(o.payment, 'transfer');

  if o.seller_id = me and o.status = 'requested' and next_status in ('confirmed', 'declined') then
    if o.expires_at < now() then raise exception 'Na objednávku už vypršel čas'; end if;
    update public.orders set status = next_status, decided_at = now() where id = target;
    if next_status = 'declined' then perform public.release_order_items(target); end if;
  -- prodejce: platba přišla
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'paid' and pay = 'transfer' and o.buyer_paid_at is not null then
    update public.orders set status = 'paid', cancel_request_at = null where id = target;
  -- prodejce: odesláno (po zaplacení, nebo rovnou u dobírky)
  elsif o.seller_id = me and o.delivery = 'ship' and next_status = 'shipped'
      and ((o.status = 'paid' and pay = 'transfer') or (o.status = 'confirmed' and pay = 'cod')) then
    update public.orders set status = 'shipped' where id = target;
  -- prodejce: předáno a zaplaceno hotově
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'delivered' and o.delivery = 'pickup' and pay = 'cash' then
    update public.orders set status = 'delivered', delivered_at = now() where id = target;
  -- prodejce: zrušit bez Zaplaceno hned, po Zaplaceno až po Nepřišla a čekání
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'cancelled' then
    if o.buyer_paid_at is not null and now() < public.order_cancel_from(o) then
      raise exception 'Zrušit půjde až po čekací době, nebo se souhlasem kupujícího';
    end if;
    update public.orders set status = 'cancelled', cancel_request_at = null where id = target;
    perform public.release_order_items(target);
  elsif o.buyer_id = me and o.status = 'requested' and next_status = 'cancelled' then
    update public.orders set status = 'cancelled' where id = target;
    perform public.release_order_items(target);
  -- kupující: převzato po odeslání, u osobního předání po zaplacení převodem
  elsif o.buyer_id = me and next_status = 'delivered'
      and (o.status = 'shipped' or (o.status = 'paid' and o.delivery = 'pickup')) then
    update public.orders set status = 'delivered', delivered_at = now() where id = target;
  else
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Hodnocení zrušené objednávky, odpověď prodejce, počítadla na profilu
-- ---------------------------------------------------------------------------
alter table public.reviews
  add column reply text check (char_length(reply) <= 500),
  add column reply_at timestamptz;

-- Kupující hodnotí převzatou objednávku, nebo tu, kterou prodejce zrušil po jeho Zaplaceno bez jeho souhlasu.
alter policy "hodnotí kupující" on public.reviews
  with check (exists (
    select 1 from public.orders o
    where o.id = order_id and o.buyer_id = auth.uid()
      and (o.status = 'delivered' or (o.status = 'cancelled' and o.buyer_paid_at is not null and not o.cancel_agreed))
  ));

-- Prodejce může na hodnocení jednou odpovědět.
create or replace function public.reply_review(p_order uuid, p_text text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  v_text text := nullif(left(trim(p_text), 500), '');
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  if v_text is null then raise exception 'Napište odpověď'; end if;
  update public.reviews set reply = v_text, reply_at = now()
  where order_id = p_order and seller_id = auth.uid() and reply is null;
  if not found then raise exception 'Na toto hodnocení už nejde odpovědět'; end if;
end;
$$;
revoke execute on function public.reply_review(uuid, text) from public, anon;
grant execute on function public.reply_review(uuid, text) to authenticated;

-- Zrušené po zaplacení u každého hodnocení (štítek), bez prozrazení dalších údajů objednávky.
create or replace function public.review_flags(p_orders uuid[]) returns table (order_id uuid, cancelled_after_paid boolean)
  language sql stable security definer set search_path = '' as $$
  select o.id, o.status = 'cancelled' from public.orders o
  join public.reviews rv on rv.order_id = o.id
  where o.id = any(p_orders);
$$;
revoke execute on function public.review_flags(uuid[]) from public;
grant execute on function public.review_flags(uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Hlášení
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  number int generated always as identity unique,
  order_id uuid not null references public.orders(id),
  reporter_id uuid references public.profiles(id) on delete set null,
  against_id uuid references public.profiles(id) on delete set null,
  reporter_role text not null check (reporter_role in ('buyer', 'seller')),
  reason text not null check (reason in ('paid_cancelled', 'not_delivered', 'not_as_described', 'buyer_not_paid', 'buyer_not_collected', 'other')),
  description text not null check (char_length(description) between 10 and 2000),
  -- seller/buyer = na tahu je strana sporu, agreed = plní se dohoda, review = prověřuje podpora
  status text not null default 'review' check (status in ('seller', 'buyer', 'agreed', 'review', 'closed')),
  outcome text check (outcome in ('agreement', 'withdrawn', 'no_agreement', 'violation', 'resolved')),
  due_at timestamptz,
  against_note text check (char_length(against_note) <= 2000),
  against_note_at timestamptz,
  support_note text check (char_length(support_note) <= 4000),
  support_note_at timestamptz,
  -- nabídka řešení u „Karta neodpovídá popisu“
  offer_kind text check (offer_kind in ('partial', 'difference', 'return', 'refund_keep')),
  offer_czk int check (offer_czk > 0),
  offer_by uuid,
  offer_note text check (char_length(offer_note) <= 500),
  offer_at timestamptz,
  rejects int not null default 0,
  agreed_at timestamptz,
  -- kam poslat peníze (vidí jen strany sporu, smaže se po uzavření)
  payout_bank text check (char_length(payout_bank) <= 40),
  payout_paypal text check (payout_paypal ~ '^[A-Za-z0-9]{1,20}$'),
  payout_revtag text check (payout_revtag ~ '^[a-z0-9._]{3,30}$'),
  payout_at timestamptz,
  return_tracking text check (char_length(return_tracking) <= 60),
  return_cost_czk int check (return_cost_czk >= 0),
  return_sent_at timestamptz,
  return_received_at timestamptz,
  comp_sent_at timestamptz,
  comp_sent_via text check (comp_sent_via in ('bank', 'paypal', 'revolut')),
  comp_received_at timestamptz,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index reports_one_open on public.reports (order_id, reporter_id) where status <> 'closed';
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index reports_against_idx on public.reports (against_id, created_at desc);
create index reports_open_idx on public.reports (status, due_at) where status <> 'closed';
alter table public.reports enable row level security;
grant select on public.reports to authenticated;
create policy "hlášení vidí strany a správci" on public.reports for select to authenticated
  using (auth.uid() in (reporter_id, against_id) or public.is_admin());

create table public.report_files (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id),
  uploader_id uuid references public.profiles(id) on delete set null,
  path text not null unique,
  name text not null check (char_length(name) <= 120),
  size int not null check (size > 0 and size <= 10485760),
  created_at timestamptz not null default now()
);
create index report_files_report_idx on public.report_files (report_id);
alter table public.report_files enable row level security;
grant select on public.report_files to authenticated;

-- Přílohu vidí kdo ji nahrál a správce; fotky ke sporu o popis i druhá strana. Doklady o platbě nikdy.
create or replace function public.report_file_visible(p_report uuid, p_uploader uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.is_admin() or p_uploader = auth.uid() or exists (
    select 1 from public.reports r
    where r.id = p_report and r.reason = 'not_as_described'
      and auth.uid() in (r.reporter_id, r.against_id) and p_uploader in (r.reporter_id, r.against_id)
  );
$$;
grant execute on function public.report_file_visible(uuid, uuid) to authenticated;
create policy "přílohy podle hlášení" on public.report_files for select to authenticated
  using (public.report_file_visible(report_id, uploader_id));

-- Soukromé úložiště příloh: <hlášení>/<uživatel>/<soubor>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-files', 'report-files', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create or replace function public.report_party(p_report uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reports r where r.id = p_report and r.status <> 'closed' and auth.uid() in (r.reporter_id, r.against_id));
$$;
grant execute on function public.report_party(uuid) to authenticated;

create or replace function public.report_object_ok(p_name text) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := storage.foldername(p_name);
  v_report uuid;
begin
  if array_length(v_parts, 1) <> 2 or v_parts[2] <> auth.uid()::text then return false; end if;
  begin v_report := v_parts[1]::uuid; exception when others then return false; end;
  return public.report_party(v_report)
    and (select count(*) from public.report_files f where f.report_id = v_report and f.uploader_id = auth.uid()) < 10;
end;
$$;
grant execute on function public.report_object_ok(text) to authenticated;

create or replace function public.report_object_visible(p_name text) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := storage.foldername(p_name);
begin
  if array_length(v_parts, 1) <> 2 then return false; end if;
  return public.report_file_visible(v_parts[1]::uuid, v_parts[2]::uuid);
exception when others then return false;
end;
$$;
grant execute on function public.report_object_visible(text) to authenticated;

create policy "příloha hlášení do vlastní složky" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-files' and public.report_object_ok(name));
create policy "příloha hlášení podle práv" on storage.objects for select to authenticated
  using (bucket_id = 'report-files' and public.report_object_visible(name));

-- Zápis přílohy po nahrání (soubor musí v úložišti opravdu být).
create or replace function public.add_report_file(p_report uuid, p_path text, p_name text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  v_size bigint;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  if not public.report_party(p_report) then raise exception 'Hlášení neexistuje'; end if;
  if p_path not like p_report::text || '/' || auth.uid()::text || '/%' then raise exception 'Neplatný soubor'; end if;
  select (metadata->>'size')::bigint into v_size from storage.objects where bucket_id = 'report-files' and name = p_path;
  if v_size is null then raise exception 'Soubor se nenahrál'; end if;
  insert into public.report_files (report_id, uploader_id, path, name, size)
    values (p_report, auth.uid(), p_path, left(coalesce(nullif(trim(p_name), ''), 'soubor'), 120), v_size)
    on conflict (path) do nothing;
end;
$$;
revoke execute on function public.add_report_file(uuid, text, text) from public, anon;
grant execute on function public.add_report_file(uuid, text, text) to authenticated;

create or replace function public.report_code(p_number int) returns text
  language sql immutable set search_path = '' as $$ select 'H-' || lpad(p_number::text, 4, '0'); $$;
grant execute on function public.report_code(int) to anon, authenticated;

create or replace function public.report_chat(r public.reports, p_sender uuid, p_body text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = r.order_id;
  if o.buyer_id is null or o.seller_id is null then return; end if;
  perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), p_sender, 'status', p_body, o.id);
end;
$$;
revoke execute on function public.report_chat(public.reports, uuid, text) from public, anon, authenticated;

-- Nahlásit problém. Kupující i prodejce, do 14 dní od převzetí, jinak do 30 dní od objednání.
create or replace function public.create_report(p_order uuid, p_reason text, p_description text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  me uuid := auth.uid();
  v_role text;
  r public.reports;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = p_order;
  if not found or me not in (o.buyer_id, o.seller_id) then raise exception 'Objednávka neexistuje'; end if;
  if o.buyer_id is null or o.seller_id is null then raise exception 'Druhá strana už nemá účet, napište podpoře'; end if;
  v_role := case when me = o.buyer_id then 'buyer' else 'seller' end;
  if not ((v_role = 'buyer' and p_reason in ('paid_cancelled', 'not_delivered', 'not_as_described', 'other'))
       or (v_role = 'seller' and p_reason in ('buyer_not_paid', 'buyer_not_collected', 'other'))) then
    raise exception 'Vyberte, co se stalo';
  end if;
  if p_reason = 'not_as_described' and o.status not in ('shipped', 'delivered', 'paid') then
    raise exception 'Kartu jste ještě nedostali';
  end if;
  if now() > greatest(o.created_at + interval '30 days', coalesce(o.delivered_at + interval '14 days', '-infinity')) then
    raise exception 'Lhůta na nahlášení uplynula, napište podpoře';
  end if;
  if exists (select 1 from public.reports x where x.order_id = p_order and x.reporter_id = me and x.status <> 'closed') then
    raise exception 'K této objednávce už hlášení máte';
  end if;
  if char_length(trim(coalesce(p_description, ''))) < 10 then raise exception 'Popište, co se stalo (aspoň pár slov)'; end if;
  insert into public.reports (order_id, reporter_id, against_id, reporter_role, reason, description, status, due_at)
  values (p_order, me, case when v_role = 'buyer' then o.seller_id else o.buyer_id end, v_role, p_reason,
    left(trim(p_description), 2000),
    case when p_reason = 'not_as_described' then 'seller' else 'review' end,
    case when p_reason = 'not_as_described' then now() + interval '3 days' end)
  returning * into r;
  perform public.report_chat(r, me,
    case v_role when 'buyer' then 'Kupující' else 'Prodejce' end || ' nahlásil problém s objednávkou č. ' || o.number
      || ' (' || public.report_code(r.number) || ')');
  return r.id;
end;
$$;
revoke execute on function public.create_report(uuid, text, text) from public, anon;
grant execute on function public.create_report(uuid, text, text) to authenticated;

-- Vyjádření druhé strany.
create or replace function public.report_reply(p_report uuid, p_text text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  v_text text := nullif(left(trim(p_text), 2000), '');
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  if v_text is null then raise exception 'Napište vyjádření'; end if;
  update public.reports set against_note = v_text, against_note_at = now()
  where id = p_report and against_id = auth.uid() and status <> 'closed';
  if not found then raise exception 'Hlášení neexistuje'; end if;
end;
$$;
revoke execute on function public.report_reply(uuid, text) from public, anon;
grant execute on function public.report_reply(uuid, text) to authenticated;

create or replace function public.close_report(r public.reports, p_outcome text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  update public.reports set status = 'closed', outcome = p_outcome, closed_at = now(), due_at = null,
    payout_bank = null, payout_paypal = null, payout_revtag = null
  where id = r.id;
end;
$$;
revoke execute on function public.close_report(public.reports, text) from public, anon, authenticated;

-- Odvolat hlášení (kdo ho podal, dokud není uzavřené).
create or replace function public.withdraw_report(p_report uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.reporter_id is distinct from auth.uid() or r.status = 'closed' then raise exception 'Hlášení neexistuje'; end if;
  perform public.close_report(r, 'withdrawn');
  select * into o from public.orders where id = r.order_id;
  perform public.report_chat(r, auth.uid(), 'Hlášení ' || public.report_code(r.number) || ' k objednávce č. ' || o.number || ' bylo odvoláno');
end;
$$;
revoke execute on function public.withdraw_report(uuid) from public, anon;
grant execute on function public.withdraw_report(uuid) to authenticated;

-- Předat podpoře (kterákoli strana).
create or replace function public.escalate_report(p_report uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or auth.uid() not in (r.reporter_id, r.against_id) or r.status in ('closed', 'review') then
    raise exception 'Hlášení neexistuje';
  end if;
  update public.reports set status = 'review', due_at = null where id = p_report;
  perform public.report_chat(r, auth.uid(), 'Hlášení ' || public.report_code(r.number) || ' převzala podpora V4cards');
end;
$$;
revoke execute on function public.escalate_report(uuid) from public, anon;
grant execute on function public.escalate_report(uuid) to authenticated;

-- Nabídka řešení u „Karta neodpovídá popisu“: prodejce nabízí, kupující může navrhnout jinou částku nebo vrácení.
create or replace function public.report_offer(p_report uuid, p_kind text, p_czk int, p_note text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  o public.orders;
  me uuid := auth.uid();
  v_items int;
  v_czk int;
  v_text text;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.reason <> 'not_as_described' then raise exception 'Hlášení neexistuje'; end if;
  select * into o from public.orders where id = r.order_id;
  if not ((r.status = 'seller' and me = o.seller_id) or (r.status = 'buyer' and me = o.buyer_id)) then
    raise exception 'Teď je na tahu druhá strana';
  end if;
  if p_kind not in ('partial', 'difference', 'return', 'refund_keep') then raise exception 'Vyberte nabídku'; end if;
  v_items := o.total_czk - o.shipping_czk;
  v_czk := case p_kind
    when 'return' then o.total_czk
    when 'refund_keep' then v_items
    else p_czk end;
  if v_czk is null or v_czk < 1 or v_czk > o.total_czk then raise exception 'Částka musí být 1 až % Kč', o.total_czk; end if;
  update public.reports set offer_kind = p_kind, offer_czk = v_czk, offer_by = me,
    offer_note = nullif(left(trim(coalesce(p_note, '')), 500), ''), offer_at = now(),
    rejects = case when r.offer_by is not null and r.offer_by <> me then r.rejects + 1 else r.rejects end,
    status = case when me = o.seller_id then 'buyer' else 'seller' end,
    due_at = now() + interval '3 days'
  where id = p_report;
  v_text := case p_kind
    when 'partial' then 'dorovnání ' || v_czk || ' Kč'
    when 'difference' then 'doplacení rozdílu ' || v_czk || ' Kč'
    when 'return' then 'vrácení karty a ' || v_czk || ' Kč'
    else 'vrácení ' || v_czk || ' Kč bez vracení karty' end;
  perform public.report_chat(r, me,
    case when me = o.seller_id then 'Prodejce' else 'Kupující' end || ' navrhuje ' || v_text
      || ' (' || public.report_code(r.number) || ')');
end;
$$;
revoke execute on function public.report_offer(uuid, text, int, text) from public, anon;
grant execute on function public.report_offer(uuid, text, int, text) to authenticated;

-- Přijmout nabídku druhé strany.
create or replace function public.accept_report_offer(p_report uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  o public.orders;
  me uuid := auth.uid();
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.offer_kind is null then raise exception 'Hlášení neexistuje'; end if;
  select * into o from public.orders where id = r.order_id;
  if not ((r.status = 'buyer' and me = o.buyer_id) or (r.status = 'seller' and me = o.seller_id)) or r.offer_by = me then
    raise exception 'Teď je na tahu druhá strana';
  end if;
  update public.reports set status = 'agreed', agreed_at = now(), due_at = now() + interval '7 days' where id = p_report;
  perform public.report_chat(r, me, 'Dohoda k hlášení ' || public.report_code(r.number) || ' přijata');
end;
$$;
revoke execute on function public.accept_report_offer(uuid) from public, anon;
grant execute on function public.accept_report_offer(uuid) to authenticated;

-- Kupující: kam poslat peníze.
create or replace function public.set_report_payout(p_report uuid, p_bank text, p_paypal text, p_revtag text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.status <> 'agreed' then raise exception 'Hlášení neexistuje'; end if;
  select * into o from public.orders where id = r.order_id;
  if auth.uid() is distinct from o.buyer_id then raise exception 'Hlášení neexistuje'; end if;
  if coalesce(nullif(trim(p_bank), ''), nullif(trim(p_paypal), ''), nullif(trim(p_revtag), '')) is null then
    raise exception 'Vyplňte aspoň jeden způsob';
  end if;
  update public.reports set payout_bank = nullif(trim(p_bank), ''), payout_paypal = nullif(trim(p_paypal), ''),
    payout_revtag = nullif(lower(trim(p_revtag)), ''), payout_at = now()
  where id = p_report;
end;
$$;
revoke execute on function public.set_report_payout(uuid, text, text, text) from public, anon;
grant execute on function public.set_report_payout(uuid, text, text, text) to authenticated;

-- Kupující: karta odeslaná zpět (číslo zásilky a cena, nejvýš tolik, kolik stála doprava k němu).
create or replace function public.report_return_sent(p_report uuid, p_tracking text, p_cost int) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.status <> 'agreed' or r.offer_kind <> 'return' then raise exception 'Hlášení neexistuje'; end if;
  select * into o from public.orders where id = r.order_id;
  if auth.uid() is distinct from o.buyer_id then raise exception 'Hlášení neexistuje'; end if;
  if char_length(trim(coalesce(p_tracking, ''))) < 4 then raise exception 'Vložte číslo zásilky'; end if;
  if p_cost is null or p_cost < 0 or p_cost > o.shipping_czk then raise exception 'Zpáteční doprava může být nejvýš % Kč', o.shipping_czk; end if;
  update public.reports set return_tracking = left(trim(p_tracking), 60), return_cost_czk = p_cost, return_sent_at = now(),
    due_at = now() + interval '10 days'
  where id = p_report;
  perform public.report_chat(r, auth.uid(), 'Kupující poslal kartu zpět (' || public.report_code(r.number) || ')');
end;
$$;
revoke execute on function public.report_return_sent(uuid, text, int) from public, anon;
grant execute on function public.report_return_sent(uuid, text, int) to authenticated;

-- Prodejce: karta dorazila zpět.
create or replace function public.report_return_received(p_report uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.status <> 'agreed' or r.return_sent_at is null or r.return_received_at is not null then raise exception 'Hlášení neexistuje'; end if;
  select * into o from public.orders where id = r.order_id;
  if auth.uid() is distinct from o.seller_id then raise exception 'Hlášení neexistuje'; end if;
  update public.reports set return_received_at = now(), due_at = now() + interval '3 days' where id = p_report;
  perform public.report_chat(r, auth.uid(), 'Prodejce převzal vrácenou kartu (' || public.report_code(r.number) || ')');
end;
$$;
revoke execute on function public.report_return_received(uuid) from public, anon;
grant execute on function public.report_return_received(uuid) to authenticated;

-- Prodejce: peníze odeslané (jen informace, V4cards platbu neověřuje).
create or replace function public.report_comp_sent(p_report uuid, p_via text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.status <> 'agreed' or r.payout_at is null or r.comp_sent_at is not null then raise exception 'Hlášení neexistuje'; end if;
  if r.offer_kind = 'return' and r.return_received_at is null then raise exception 'Nejdřív potvrďte, že karta dorazila'; end if;
  select * into o from public.orders where id = r.order_id;
  if auth.uid() is distinct from o.seller_id then raise exception 'Hlášení neexistuje'; end if;
  if not ((p_via = 'bank' and r.payout_bank is not null) or (p_via = 'paypal' and r.payout_paypal is not null)
       or (p_via = 'revolut' and r.payout_revtag is not null)) then
    raise exception 'Tento způsob kupující nevyplnil';
  end if;
  update public.reports set comp_sent_at = now(), comp_sent_via = p_via, due_at = now() + interval '3 days' where id = p_report;
  perform public.report_chat(r, auth.uid(), 'Prodejce poslal peníze k hlášení ' || public.report_code(r.number));
end;
$$;
revoke execute on function public.report_comp_sent(uuid, text) from public, anon;
grant execute on function public.report_comp_sent(uuid, text) to authenticated;

-- Kupující: peníze přišly (uzavře hlášení dohodou), nebo nepřišly (prodejce posílá znovu).
create or replace function public.report_comp_received(p_report uuid, p_ok boolean) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.status <> 'agreed' or r.comp_sent_at is null then raise exception 'Hlášení neexistuje'; end if;
  select * into o from public.orders where id = r.order_id;
  if auth.uid() is distinct from o.buyer_id then raise exception 'Hlášení neexistuje'; end if;
  if p_ok then
    update public.reports set comp_received_at = now() where id = p_report;
    perform public.close_report(r, 'agreement');
    perform public.report_chat(r, auth.uid(), 'Kupující potvrdil peníze, hlášení ' || public.report_code(r.number) || ' je uzavřené dohodou');
  else
    update public.reports set comp_sent_at = null, comp_sent_via = null where id = p_report;
    perform public.report_chat(r, auth.uid(), 'Kupující zatím nevidí peníze k hlášení ' || public.report_code(r.number));
  end if;
end;
$$;
revoke execute on function public.report_comp_received(uuid, boolean) from public, anon;
grant execute on function public.report_comp_received(uuid, boolean) to authenticated;

-- Podpora: vyjádření, stav a uzavření.
create or replace function public.admin_update_report(p_report uuid, p_note text, p_outcome text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
begin
  if not public.is_admin() then raise exception 'Jen pro správce'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'Hlášení neexistuje'; end if;
  if nullif(trim(p_note), '') is not null then
    update public.reports set support_note = left(trim(p_note), 4000), support_note_at = now(),
      status = case when status = 'closed' then status else 'review' end
    where id = p_report;
    perform public.report_chat(r, null, 'Podpora V4cards se vyjádřila k hlášení ' || public.report_code(r.number));
  end if;
  if p_outcome in ('no_agreement', 'violation', 'resolved') and r.status <> 'closed' then
    perform public.close_report(r, p_outcome);
  end if;
end;
$$;
revoke execute on function public.admin_update_report(uuid, text, text) from public, anon;
grant execute on function public.admin_update_report(uuid, text, text) to authenticated;

-- Když strana sporu do lhůty nereaguje, hlášení převezme podpora (každou hodinu).
create or replace function public.escalate_due_reports() returns int
  language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  n int := 0;
begin
  for r in select * from public.reports where status in ('seller', 'buyer', 'agreed') and due_at < now() for update skip locked loop
    update public.reports set status = 'review', due_at = null where id = r.id;
    perform public.report_chat(r, null, 'Lhůta u hlášení ' || public.report_code(r.number) || ' uplynula, převzala ho podpora V4cards');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.escalate_due_reports() from public, anon, authenticated;
select cron.schedule('reports-escalate', '7 * * * *', $$select public.escalate_due_reports()$$);

-- Hlášení k objednávkám (pruh „Objednávku prošetřujeme“), jen pro strany.
create or replace function public.order_open_reports(p_orders uuid[]) returns table (order_id uuid, report_id uuid, number int, status text)
  language sql stable security definer set search_path = '' as $$
  select r.order_id, r.id, r.number, r.status from public.reports r
  join public.orders o on o.id = r.order_id
  where r.order_id = any(p_orders) and r.status <> 'closed' and auth.uid() in (o.buyer_id, o.seller_id);
$$;
revoke execute on function public.order_open_reports(uuid[]) from public, anon;
grant execute on function public.order_open_reports(uuid[]) to authenticated;

-- Počítadla na profilu prodejce za 12 měsíců.
create or replace function public.seller_trust(p_seller uuid) returns table (cancelled_after_paid int, disputes int)
  language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::int from public.orders o
      where o.seller_id = p_seller and o.status = 'cancelled' and o.buyer_paid_at is not null and not o.cancel_agreed
        and o.created_at > now() - interval '12 months'),
    (select count(*)::int from public.reports r
      where r.against_id = p_seller and r.reporter_role = 'buyer' and r.outcome in ('no_agreement', 'violation')
        and r.created_at > now() - interval '12 months');
$$;
revoke execute on function public.seller_trust(uuid) from public;
grant execute on function public.seller_trust(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Obchod (podnikatel s IČO) a Sběratel (soukromý prodejce s prohlášením)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column ico text check (ico ~ '^[0-9]{8}$'),
  add column private_declared_at timestamptz;
