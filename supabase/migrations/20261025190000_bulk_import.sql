-- Hromadné nahrávání nabídek (CSV, Excel, export z Cardmarketu), hromadné úpravy a tarify předplatného.
-- Nic se nemaže ani nepřepisuje, jen přibývá tabulka a funkce.

-- Předplatné: tři tarify, zdarma (bez řádku v tabulce) a dva placené (plus, pro).
-- Zatím ho přiděluje správce, placení přijde s platbami (fáze D). Výhody tarifů (limity, úpravy stránky)
-- určuje web podle current_plan(), takže jdou měnit bez migrace. Názvy tarifů jsou jen v kódu webu.
create table public.subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan text not null check (plan in ('plus', 'pro')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  note text check (char_length(note) <= 200)
);
alter table public.subscriptions enable row level security;
create policy "vlastní předplatné a správce" on public.subscriptions for select
  using (user_id = auth.uid() or public.is_admin());
grant select on public.subscriptions to authenticated;

-- Tarif přihlášeného uživatele: free, plus nebo pro.
create or replace function public.current_plan() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select plan from public.subscriptions where user_id = auth.uid()), 'free');
$$;
revoke execute on function public.current_plan() from public, anon;
grant execute on function public.current_plan() to authenticated;

-- Správce nastaví tarif podle e-mailu (free = odebrat předplatné). Vrací jméno prodejce.
create or replace function public.admin_set_plan(p_email text, p_plan text, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if not public.is_admin() or not public.mfa_ok() then
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
  return (select display_name from public.profiles where id = uid);
end;
$$;
revoke execute on function public.admin_set_plan(text, text, text) from public, anon;
grant execute on function public.admin_set_plan(text, text, text) to authenticated;

-- Seznam předplatitelů pro správce (s e-mailem z auth.users).
create or replace function public.admin_list_subscriptions()
returns table (user_id uuid, display_name text, email text, plan text, granted_at timestamptz, note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Jen pro správce'; end if;
  return query
    select s.user_id, p.display_name, u.email::text, s.plan, s.granted_at, s.note
    from public.subscriptions s
    join public.profiles p on p.id = s.user_id
    join auth.users u on u.id = s.user_id
    order by s.granted_at desc;
end;
$$;
revoke execute on function public.admin_list_subscriptions() from public, anon;
grant execute on function public.admin_list_subscriptions() to authenticated;

-- Číslo karty pro porovnání: bez mezer, malými písmeny, jen část před lomítkem, bez úvodních nul.
-- „025/198“ → „25“, „OP05-063“ → „op05-063“, „#5p“ → „5p“.
create or replace function public.import_number_key(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(regexp_replace(lower(ltrim(split_part(replace(trim(coalesce(p, '')), ' ', ''), '/', 1), '#')), '^0+(?=.)', ''), '');
$$;

-- Spárování řádků importu s katalogem. Vstup: pole objektů {idx, game, set_code, set_name, number, name}.
-- Pořadí pokusů: 1) sada (kód nebo název) + číslo, 2) sada + název, 3) název (+ číslo, když sedí).
-- Výsledek pro každý řádek: ok (jedna karta), multi (víc kandidátů), none; kandidátů nejvýš 8.
-- Běží s právy volajícího, takže skryté karty (RLS) se nenabídnou.
create or replace function public.match_import_rows(p_rows jsonb)
returns table (idx int, status text, candidates jsonb)
language sql stable security invoker set search_path = '' as $$
  with input as (
    select r.idx,
           nullif(trim(r.game), '') as game,
           lower(nullif(trim(r.set_code), '')) as set_code,
           lower(public.unaccent_immutable(nullif(trim(r.set_name), ''))) as set_name,
           public.import_number_key(r.number) as num,
           lower(public.unaccent_immutable(nullif(trim(r.name), ''))) as nm
    from jsonb_to_recordset(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end)
      as r(idx int, game text, set_code text, set_name text, number text, name text)
    limit 500
  ),
  set_keys as materialized (
    select s.id, s.game_id, lower(s.code) as code_l, lower(public.unaccent_immutable(s.name)) as name_l
    from public.card_sets s
  ),
  row_sets as (
    select i.idx, s.id as set_id
    from input i join set_keys s on s.code_l = i.set_code and (i.game is null or s.game_id = i.game)
    union
    select i.idx, s.id
    from input i join set_keys s on s.name_l = i.set_name and (i.game is null or s.game_id = i.game)
  ),
  -- Karty jen ze sad, které se v souboru objevily, s klíči spočítanými jednou.
  set_cards as materialized (
    select c.id, c.set_id,
           public.import_number_key(c.number) as k1,
           public.import_number_key(regexp_replace(c.number, '^.*-', '')) as k2,
           lower(public.unaccent_immutable(c.name)) as n1,
           lower(public.unaccent_immutable(split_part(c.name, ' // ', 1))) as n2
    from public.cards c
    where c.set_id in (select rs.set_id from row_sets rs) and not c.hidden
  ),
  by_number as (
    select i.idx, sc.id, i.nm is not null and i.nm in (sc.n1, sc.n2) as name_ok
    from input i
    join row_sets rs on rs.idx = i.idx
    join set_cards sc on sc.set_id = rs.set_id
    where i.num is not null and i.num in (sc.k1, sc.k2)
  ),
  by_set_name as (
    select i.idx, sc.id
    from input i
    join row_sets rs on rs.idx = i.idx
    join set_cards sc on sc.set_id = rs.set_id
    where i.nm is not null and i.nm in (sc.n1, sc.n2)
      and not exists (select 1 from by_number b where b.idx = i.idx)
  ),
  by_name as (
    select i.idx, c.id, i.num is not null and public.import_number_key(c.number) = i.num as num_ok
    from input i
    join public.cards c on lower(public.unaccent_immutable(c.name)) = i.nm and not c.hidden
    where i.nm is not null
      and (i.game is null or c.game_id = i.game)
      and not exists (select 1 from by_number b where b.idx = i.idx)
      and not exists (select 1 from by_set_name b where b.idx = i.idx)
  ),
  picked as (
    select b.idx, b.id from by_number b
    where b.name_ok or not exists (select 1 from by_number x where x.idx = b.idx and x.name_ok)
    union
    select b.idx, b.id from by_set_name b
    union
    select b.idx, b.id from by_name b
    where b.num_ok or not exists (select 1 from by_name x where x.idx = b.idx and x.num_ok)
  ),
  counted as (
    select p.idx, count(*) as n from picked p group by p.idx
  )
  select i.idx,
         case when coalesce(k.n, 0) = 0 then 'none' when k.n = 1 then 'ok' else 'multi' end,
         coalesce(cand.list, '[]'::jsonb)
  from input i
  left join counted k on k.idx = i.idx
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'slug', t.slug, 'name', t.name, 'number', t.number, 'game', t.game_id,
             'setCode', t.code, 'setName', t.set_name, 'image', t.image_url
           ) order by t.released_on desc nulls last, t.number) as list
    from (
      select c.id, c.slug, c.name, c.number, c.game_id, s.code, s.name as set_name, c.image_url, c.released_on
      from picked p
      join public.cards c on c.id = p.id
      join public.card_sets s on s.id = c.set_id
      where p.idx = i.idx
      order by c.released_on desc nulls last, c.number
      limit 8
    ) t
  ) cand on true
  order by i.idx;
$$;
revoke execute on function public.match_import_rows(jsonb) from public, anon;
grant execute on function public.match_import_rows(jsonb) to authenticated;

-- Hromadná úprava vlastních nabídek: změna ceny o procenta, pevná cena, počet kusů.
-- Běží s právy volajícího, RLS pustí jen vlastní nabídky (a jen po dvoufázovém ověření, je-li zapnuté).
create or replace function public.bulk_update_listings(
  p_ids uuid[], p_price_pct numeric default null, p_price int default null, p_quantity int default null
) returns int
language plpgsql security invoker set search_path = '' as $$
declare
  n int;
begin
  if p_price is not null and p_price <= 0 then raise exception 'Cena musí být kladná'; end if;
  if p_quantity is not null and (p_quantity < 0 or p_quantity > 999) then raise exception 'Počet kusů musí být 0 až 999'; end if;
  if p_price_pct is not null and (p_price_pct <= -100 or p_price_pct > 1000) then raise exception 'Změna ceny musí být mezi -99 a 1000 %%'; end if;
  update public.listings
     set price_czk = coalesce(p_price,
           case when p_price_pct is null then price_czk
                else greatest(1, round(price_czk * (1 + p_price_pct / 100.0))::int) end),
         quantity = coalesce(p_quantity, quantity)
   where id = any(p_ids) and seller_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.bulk_update_listings(uuid[], numeric, int, int) from public, anon;
grant execute on function public.bulk_update_listings(uuid[], numeric, int, int) to authenticated;

-- Stažení nabídek z prodeje: nabídka bez objednávek se smaže, s objednávkou jen dostane 0 kusů
-- (objednávky na ni dál odkazují).
create or replace function public.withdraw_listings(p_ids uuid[]) returns int
language plpgsql security invoker set search_path = '' as $$
declare
  deleted int;
  emptied int;
begin
  delete from public.listings l
   where l.id = any(p_ids) and l.seller_id = auth.uid()
     and not exists (select 1 from public.order_items oi where oi.listing_id = l.id);
  get diagnostics deleted = row_count;
  update public.listings set quantity = 0
   where id = any(p_ids) and seller_id = auth.uid() and quantity > 0;
  get diagnostics emptied = row_count;
  return deleted + emptied;
end;
$$;
revoke execute on function public.withdraw_listings(uuid[]) from public, anon;
grant execute on function public.withdraw_listings(uuid[]) to authenticated;
