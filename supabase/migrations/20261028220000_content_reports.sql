-- Nahlášení obsahu (Šimon 28. 10., DSA čl. 16, DS Reports › Nahlásit obsah): nabídka, prodejce,
-- zpráva v chatu, hodnocení a cokoli přes formulář v patičce. Každé nahlášení založí případ podpory,
-- další nahlášení téže věci se připojí k otevřenému případu. Nic se nemaže, jen přibývají sloupce,
-- tabulka a funkce.

-- Obsah skrytý podporou.
alter table public.listings add column removed_at timestamptz;
alter table public.messages add column hidden_at timestamptz;
alter table public.reviews add column hidden_at timestamptz;

-- Nabídku odstraněnou podporou už nejde znovu vystavit (množství zůstane 0).
create or replace function public.listing_keep_removed() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.removed_at is not null then new.quantity := 0; end if;
  return new;
end;
$$;
create trigger listings_keep_removed before update on public.listings
  for each row execute function public.listing_keep_removed();

-- Skryté hodnocení nevidí nikdo kromě týmu (zmizí z profilu i z průměru na webu).
create policy "skrytá hodnocení vidí jen tým" on public.reviews as restrictive for select
  using (hidden_at is null or public.is_admin());

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  number int generated always as identity unique,
  target_kind text not null check (target_kind in ('listing', 'seller', 'message', 'review', 'other')),
  listing_id uuid references public.listings(id) on delete set null,
  message_id bigint references public.messages(id) on delete set null,
  review_id uuid references public.reviews(order_id) on delete set null,
  -- autor nahlášeného obsahu (prodejce, odesílatel zprávy, autor hodnocení)
  author_id uuid references public.profiles(id) on delete set null,
  url text check (char_length(url) <= 500),
  reason text not null check (reason in ('counterfeit', 'mismatch', 'fraud', 'prohibited', 'impersonation', 'offensive',
    'spam', 'harassment', 'off_platform', 'fake_review', 'unrelated', 'illegal', 'other')),
  body text not null check (char_length(body) between 10 and 2000),
  reporter_id uuid references public.profiles(id) on delete set null,
  reporter_name text check (char_length(reporter_name) <= 120),
  reporter_email text check (char_length(reporter_email) <= 200),
  -- obsah tak, jak vypadal při nahlášení
  snapshot jsonb not null default '{}',
  case_id uuid references public.support_cases(id),
  decision text check (decision in ('kept', 'removed')),
  facts text check (char_length(facts) <= 4000),
  decided_at timestamptz,
  decided_by uuid,
  created_at timestamptz not null default now()
);
create index content_reports_case_idx on public.content_reports (case_id);
create index content_reports_author_idx on public.content_reports (author_id, created_at desc);
create index content_reports_reporter_idx on public.content_reports (reporter_id, created_at desc);
alter table public.content_reports enable row level security;
grant select on public.content_reports to authenticated;
create policy "nahlášení vidí autor nahlášení a tým" on public.content_reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

create or replace function public.content_code(p_number int) returns text
  language sql immutable set search_path = '' as $$ select 'N-' || lpad(p_number::text, 4, '0'); $$;
grant execute on function public.content_code(int) to anon, authenticated;

create or replace function public.content_reason_label(p_reason text) returns text
  language sql immutable set search_path = '' as $$
  select case p_reason
    when 'counterfeit' then 'Padělek nebo kopie karty'
    when 'mismatch' then 'Fotka nebo popis neodpovídá kartě'
    when 'fraud' then 'Podezření na podvod'
    when 'prohibited' then 'Zakázané zboží'
    when 'impersonation' then 'Vydává se za někoho jiného'
    when 'offensive' then 'Urážlivý nebo nevhodný obsah'
    when 'spam' then 'Spam'
    when 'harassment' then 'Obtěžování nebo urážky'
    when 'off_platform' then 'Platba mimo dohodnutý způsob nebo podezřelý odkaz'
    when 'fake_review' then 'Falešné hodnocení'
    when 'unrelated' then 'Hodnocení se netýká objednávky'
    when 'illegal' then 'Nezákonný obsah'
    else 'Jiné porušení pravidel' end;
$$;

-- Nahlásit obsah. Přihlášený u nabídky, prodejce, zprávy a hodnocení; kdokoli přes patičku (other).
-- Vrací číslo nahlášení, e-mail pro potvrzení a zda se připojilo k otevřenému případu.
create or replace function public.report_content(p_kind text, p_target text, p_reason text, p_body text,
  p_url text default null, p_name text default null, p_email text default null)
returns table (number int, email text, merged boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_merged boolean := false;
  v_body text := left(trim(coalesce(p_body, '')), 2000);
  v_name text;
  v_email text;
  v_listing uuid;
  v_message bigint;
  v_review uuid;
  v_author uuid;
  v_url text := nullif(left(trim(coalesce(p_url, '')), 500), '');
  v_snap jsonb := '{}';
  v_case public.support_cases;
  v_r public.content_reports;
  v_prio text;
  v_label text;
begin
  if p_kind not in ('listing', 'seller', 'message', 'review', 'other') then raise exception 'Neznámý typ nahlášení'; end if;
  if v_uid is null and p_kind <> 'other' then raise exception 'Pro nahlášení se přihlaste'; end if;
  if not (
    (p_kind = 'listing' and p_reason in ('counterfeit', 'mismatch', 'fraud', 'prohibited', 'other'))
    or (p_kind = 'seller' and p_reason in ('impersonation', 'fraud', 'offensive', 'spam', 'other'))
    or (p_kind = 'message' and p_reason in ('harassment', 'off_platform', 'spam', 'other'))
    or (p_kind = 'review' and p_reason in ('fake_review', 'offensive', 'unrelated', 'other'))
    or (p_kind = 'other' and p_reason in ('illegal', 'counterfeit', 'fraud', 'offensive', 'other'))
  ) then raise exception 'Vyberte, co je špatně'; end if;
  if char_length(v_body) < 10 then raise exception 'Popište, co je špatně (aspoň pár slov)'; end if;

  if v_uid is null then
    v_name := nullif(left(trim(coalesce(p_name, '')), 120), '');
    v_email := lower(nullif(left(trim(coalesce(p_email, '')), 200), ''));
    if v_name is null then raise exception 'Vyplňte jméno'; end if;
    if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Vyplňte platný e-mail'; end if;
  else
    select p.display_name into v_name from public.profiles p where p.id = v_uid;
    select u.email::text into v_email from auth.users u where u.id = v_uid;
  end if;

  if (select count(*) from public.content_reports c
      where c.created_at > now() - interval '1 day'
        and (c.reporter_id = v_uid or (v_uid is null and c.reporter_email = v_email))) >= 10 then
    raise exception 'Dnes jste odeslali už 10 nahlášení. Další můžete poslat zítra.';
  end if;

  if p_kind = 'listing' then
    select l.id, l.seller_id,
      jsonb_build_object('card', c.name, 'set', s.name, 'number', c.number, 'slug', c.slug, 'image', c.image_url,
        'price', l.price_czk, 'condition', l.condition, 'language', l.language, 'graded', l.graded, 'note', l.note,
        'quantity', l.quantity, 'seller', p.display_name)
      into v_listing, v_author, v_snap
    from public.listings l
    join public.cards c on c.id = l.card_id
    join public.card_sets s on s.id = c.set_id
    join public.profiles p on p.id = l.seller_id
    where l.id::text = p_target and l.removed_at is null;
    if v_listing is null then raise exception 'Nabídka už neexistuje'; end if;
  elsif p_kind = 'seller' then
    select p.id, jsonb_build_object('name', p.display_name, 'kind', p.kind, 'slug', sp.slug, 'tagline', sp.tagline,
        'published', coalesce(sp.published, false))
      into v_author, v_snap
    from public.profiles p left join public.shop_pages sp on sp.user_id = p.id
    where p.id::text = p_target;
    if v_author is null then raise exception 'Prodejce už neexistuje'; end if;
  elsif p_kind = 'message' then
    select m.id, m.sender_id, jsonb_build_object('body', m.body, 'sender', p.display_name, 'sent_at', m.created_at)
      into v_message, v_author, v_snap
    from public.messages m
    join public.conversations cv on cv.id = m.conversation_id
    left join public.profiles p on p.id = m.sender_id
    where m.id::text = p_target and m.kind = 'text' and m.hidden_at is null and v_uid in (cv.user_a, cv.user_b);
    if v_message is null then raise exception 'Zpráva už neexistuje'; end if;
  elsif p_kind = 'review' then
    select r.order_id, o.buyer_id,
      jsonb_build_object('rating', r.rating, 'comment', r.comment, 'reply', r.reply, 'written_at', r.created_at,
        'seller', p.display_name, 'seller_id', r.seller_id)
      into v_review, v_author, v_snap
    from public.reviews r
    join public.orders o on o.id = r.order_id
    join public.profiles p on p.id = r.seller_id
    where r.order_id::text = p_target and r.hidden_at is null;
    if v_review is null then raise exception 'Hodnocení už neexistuje'; end if;
  else
    if v_url is null or v_url !~* '^https?://' then raise exception 'Vložte odkaz na stránku, které se nahlášení týká'; end if;
  end if;
  if v_author is not null and v_author = v_uid then raise exception 'Vlastní obsah nahlásit nejde'; end if;

  -- Otevřený případ k téže věci?
  select sc.* into v_case
  from public.content_reports c join public.support_cases sc on sc.id = c.case_id
  where sc.status <> 'resolved' and c.target_kind = p_kind and (
    (p_kind = 'listing' and c.listing_id = v_listing)
    or (p_kind = 'seller' and c.author_id = v_author)
    or (p_kind = 'message' and c.message_id = v_message)
    or (p_kind = 'review' and c.review_id = v_review)
    or (p_kind = 'other' and c.url = v_url))
  order by sc.created_at desc limit 1;
  v_merged := v_case.id is not null;

  insert into public.content_reports (target_kind, listing_id, message_id, review_id, author_id, url, reason, body,
    reporter_id, reporter_name, reporter_email, snapshot, case_id)
  values (p_kind, v_listing, v_message, v_review, v_author, v_url, p_reason, v_body,
    v_uid, v_name, v_email, v_snap, v_case.id)
  returning * into v_r;

  if v_case.id is null then
    v_prio := case when p_reason in ('counterfeit', 'fraud', 'prohibited', 'illegal') then 'high' else 'mid' end;
    v_label := case p_kind when 'listing' then 'Nahlášená nabídka' when 'seller' then 'Nahlášený prodejce'
      when 'message' then 'Nahlášená zpráva' when 'review' then 'Nahlášené hodnocení' else 'Nahlášený obsah' end;
    insert into public.support_cases (kind, subject, priority, due_at, user_id, other_id, contact_email)
    values ('content', v_label || ': ' || public.content_reason_label(p_reason), v_prio, public.case_due('content', v_prio),
      v_uid, v_author, case when v_uid is null then v_email end)
    returning * into v_case;
    update public.content_reports set case_id = v_case.id where id = v_r.id;
    insert into public.case_events (case_id, kind, author_id, body)
    values (v_case.id, 'user', v_uid, public.content_code(v_r.number) || ' · ' || public.content_reason_label(p_reason)
      || coalesce(' · ' || v_url, '') || E'\n\n' || v_body);
  else
    insert into public.case_events (case_id, kind, author_id, body)
    values (v_case.id, 'user', v_uid, 'Další nahlášení ' || public.content_code(v_r.number) || ' · '
      || public.content_reason_label(p_reason) || E'\n\n' || v_body);
    if v_case.status = 'waiting' then
      update public.support_cases set status = 'open', due_at = public.case_due(v_case.kind, v_case.priority) where id = v_case.id;
    end if;
  end if;

  return query select v_r.number, v_email, v_merged;
end;
$$;
revoke execute on function public.report_content(text, text, text, text, text, text, text) from public;
grant execute on function public.report_content(text, text, text, text, text, text, text) to anon, authenticated;

-- Rozhodnutí podpory o všech nahlášeních v případu: kept = v pořádku, removed = skrýt obsah.
-- Případ se vyřeší. Vrací nahlašitele a autora, web jim pošle e-maily.
create or replace function public.admin_decide_content(p_case uuid, p_decision text, p_facts text)
returns table (target_kind text, author_id uuid, author_email text, author_name text,
  reporter_emails text[], numbers int[], snapshot jsonb, case_number int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_case public.support_cases;
  v_first public.content_reports;
  v_facts text := nullif(left(trim(coalesce(p_facts, '')), 4000), '');
begin
  if not public.is_admin() or not public.mfa_ok() then raise exception 'Rozhodnout může jen tým podpory'; end if;
  if p_decision not in ('kept', 'removed') then raise exception 'Neznámé rozhodnutí'; end if;
  select * into v_case from public.support_cases where id = p_case for update;
  if v_case.id is null or v_case.kind <> 'content' then raise exception 'Případ neexistuje'; end if;
  select * into v_first from public.content_reports c where c.case_id = p_case order by c.created_at limit 1;
  if v_first.id is null then raise exception 'K případu není žádné nahlášení'; end if;
  if p_decision = 'removed' then
    if v_first.target_kind not in ('listing', 'message', 'review') then
      raise exception 'Prodejce ani obsah mimo web skrýt nejde, použijte Omezit účet';
    end if;
    if v_facts is null or char_length(v_facts) < 20 then
      raise exception 'Popište, z čeho vycházíte (uvidí to autor)';
    end if;
  end if;

  update public.content_reports c set decision = p_decision, facts = v_facts, decided_at = now(), decided_by = auth.uid()
  where c.case_id = p_case and c.decision is null;

  if p_decision = 'removed' then
    if v_first.target_kind = 'listing' then
      update public.listings set removed_at = now(), hidden_qty = coalesce(hidden_qty, 0) + quantity, quantity = 0
      where id = v_first.listing_id and removed_at is null;
    elsif v_first.target_kind = 'message' then
      update public.conversations cv set last_body = 'Zprávu skryla podpora V4cards.'
      from public.messages m
      where m.id = v_first.message_id and cv.id = m.conversation_id and m.hidden_at is null and cv.last_body = m.body;
      update public.messages set body = 'Zprávu skryla podpora V4cards.', hidden_at = now()
      where id = v_first.message_id and hidden_at is null;
    else
      update public.reviews set hidden_at = now() where order_id = v_first.review_id and hidden_at is null;
    end if;
  end if;

  insert into public.case_events (case_id, kind, author_id, body)
  values (p_case, 'event', auth.uid(), case p_decision when 'removed' then 'Obsah skryt' else 'Nahlášení prověřeno, obsah v pořádku' end
    || coalesce(E'\n\n' || v_facts, ''));
  update public.support_cases set status = 'resolved', resolved_at = now(), assignee_id = coalesce(assignee_id, auth.uid())
  where id = p_case;

  return query
    select v_first.target_kind, v_first.author_id, (select u.email::text from auth.users u where u.id = v_first.author_id),
      (select p.display_name from public.profiles p where p.id = v_first.author_id),
      array(select distinct c.reporter_email from public.content_reports c where c.case_id = p_case and c.reporter_email is not null),
      array(select c.number from public.content_reports c where c.case_id = p_case order by c.number),
      v_first.snapshot, v_case.number;
end;
$$;
revoke execute on function public.admin_decide_content(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_content(uuid, text, text) to authenticated;
