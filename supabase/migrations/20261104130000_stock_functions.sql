-- Sklad a Sbírka (fáze 1): funkce pro web. Běží s právy přihlášeného (RLS platí), cizí řádky nezmění.

-- Krátký popis řádku skladu do Detailu historie: „120 Kč · 2 na prodej · 1 mimo prodej“.
create or replace function public.stock_row_text(p_price int, p_qty int, p_keep int)
  returns text language sql immutable set search_path = '' as $$
  select case when p_price is null then case when coalesce(p_qty, 0) > 0 then 'dohodou' else 'bez ceny' end
              else p_price || ' Kč' end
    || ' · ' || coalesce(p_qty, 0) || ' na prodej'
    || case when coalesce(p_keep, 0) > 0 then ' · ' || p_keep || ' mimo prodej' else '' end
$$;

-- Změna řádků skladu s uložením do Historie (stav před změnou pro Vrátit + ukázka změn).
-- p_op: pct (cena o p_num %), price (cena p_num Kč), negotiable (cena dohodou), sell (vše na prodej),
--       unsell (vše mimo prodej), trade_all / trade_none (výměna), location (p_text), set (jeden řádek, p_set), remove (odebrat ze skladu).
create or replace function public.stock_change(p_ids uuid[], p_op text, p_title text,
    p_num numeric default null, p_text text default null, p_set jsonb default null)
  returns int language plpgsql set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  ids uuid[];
  before jsonb;
  n int := 0;
  k text := 'stock';
begin
  if uid is null then raise exception 'Nejdřív se přihlaste' using errcode = '42501'; end if;
  if p_op not in ('pct', 'price', 'negotiable', 'sell', 'unsell', 'trade_all', 'trade_none', 'location', 'set', 'remove') then
    raise exception 'Neznámá změna';
  end if;
  ids := array(select l.id from public.listings l
    where l.id = any(p_ids) and l.seller_id = uid and l.removed_at is null and l.hidden_qty is null);
  if p_op = 'set' and coalesce(array_length(ids, 1), 0) <> 1 then raise exception 'Upravit jde jen jeden řádek'; end if;
  if coalesce(array_length(ids, 1), 0) = 0 then return 0; end if;
  if p_op in ('pct', 'price', 'negotiable') then k := 'price'; end if;
  if p_op = 'pct' and (p_num is null or p_num <= -100 or p_num > 1000 or p_num = 0) then raise exception 'Změna ceny musí být mezi -99 a 1000 %%'; end if;
  if p_op = 'price' and (p_num is null or p_num <= 0 or p_num <> trunc(p_num)) then raise exception 'Cena musí být celé kladné číslo'; end if;

  select jsonb_agg(jsonb_build_object('id', l.id, 'card_id', l.card_id, 'price_czk', l.price_czk, 'negotiable', l.negotiable, 'quantity', l.quantity,
      'keep_qty', s.keep_qty, 'trade_qty', s.trade_qty, 'location', s.location))
    into before
    from public.listings l join public.listing_stock s on s.listing_id = l.id
   where l.id = any(ids);

  if p_op = 'pct' then
    update public.listings set price_czk = greatest(1, round(price_czk * (1 + p_num / 100.0))::int)
     where id = any(ids) and price_czk is not null;
  elsif p_op = 'price' then
    update public.listings set price_czk = p_num::int, negotiable = false where id = any(ids);
  elsif p_op = 'negotiable' then
    update public.listings set price_czk = null, negotiable = true where id = any(ids);
  elsif p_op = 'sell' then
    update public.listings l set quantity = l.quantity + s.keep_qty
      from public.listing_stock s where s.listing_id = l.id and l.id = any(ids) and s.keep_qty > 0;
    update public.listing_stock set keep_qty = 0, updated_at = now(), listed_at = coalesce(listed_at, now())
     where listing_id = any(ids) and keep_qty > 0;
  elsif p_op = 'unsell' then
    update public.listing_stock s set keep_qty = s.keep_qty + l.quantity, updated_at = now()
      from public.listings l where s.listing_id = l.id and l.id = any(ids) and l.quantity > 0;
    update public.listings set quantity = 0 where id = any(ids) and quantity > 0;
  elsif p_op = 'trade_all' then
    update public.listing_stock s set trade_qty = l.quantity + s.keep_qty, updated_at = now()
      from public.listings l where s.listing_id = l.id and l.id = any(ids);
  elsif p_op = 'trade_none' then
    update public.listing_stock set trade_qty = 0, updated_at = now() where listing_id = any(ids);
  elsif p_op = 'location' then
    update public.listing_stock set location = nullif(left(trim(coalesce(p_text, '')), 60), ''), updated_at = now()
     where listing_id = any(ids);
  elsif p_op = 'set' then
    if p_set ? 'price_czk' then
      if jsonb_typeof(p_set->'price_czk') = 'null' then
        update public.listings set price_czk = null, negotiable = true where id = ids[1];
      else
        update public.listings set price_czk = (p_set->>'price_czk')::int, negotiable = false where id = ids[1];
      end if;
    end if;
    if p_set ? 'quantity' then
      update public.listings set quantity = (p_set->>'quantity')::int where id = ids[1];
    end if;
    update public.listing_stock set
        keep_qty = coalesce((p_set->>'keep_qty')::int, keep_qty),
        trade_qty = coalesce((p_set->>'trade_qty')::int, trade_qty),
        location = case when p_set ? 'location' then nullif(left(trim(coalesce(p_set->>'location', '')), 60), '') else location end,
        buy_price_czk = case when p_set ? 'buy_price_czk' then (p_set->>'buy_price_czk')::int else buy_price_czk end,
        updated_at = now()
     where listing_id = ids[1];
    update public.listing_stock s set listed_at = coalesce(s.listed_at, now())
      from public.listings l where s.listing_id = l.id and l.id = ids[1] and l.quantity > 0;
  elsif p_op = 'remove' then
    -- Řádek bez objednávek zmizí, s objednávkou zůstane prázdný (objednávka na něj odkazuje).
    delete from public.listings l where l.id = any(ids)
      and not exists (select 1 from public.order_items oi where oi.listing_id = l.id);
    update public.listings set quantity = 0 where id = any(ids) and quantity > 0;
    update public.listing_stock set keep_qty = 0, trade_qty = 0, updated_at = now() where listing_id = any(ids);
  end if;

  -- Výměna nesmí být víc než kusů celkem (výměna se smí překrývat s prodejem).
  update public.listing_stock s set trade_qty = l.quantity + s.keep_qty
    from public.listings l where s.listing_id = l.id and l.id = any(ids) and s.trade_qty > l.quantity + s.keep_qty;

  n := coalesce(array_length(ids, 1), 0);
  insert into public.stock_events (owner_id, actor_id, kind, title, undo, sample)
  select uid, uid, k, left(coalesce(nullif(trim(p_title), ''), 'Úprava skladu'), 200),
    case when p_op = 'remove' then null else
      (select jsonb_agg(b || jsonb_build_object('total_before', (b->>'quantity')::int + (b->>'keep_qty')::int,
                                                'total_after', coalesce(l.quantity + s.keep_qty, 0)))
         from jsonb_array_elements(before) b
         left join public.listings l on l.id = (b->>'id')::uuid
         left join public.listing_stock s on s.listing_id = l.id) end,
    (select jsonb_agg(x) from (
       select jsonb_build_array(c.name,
                public.stock_row_text((b->>'price_czk')::int, (b->>'quantity')::int, (b->>'keep_qty')::int),
                case when l.id is null then 'odebráno' else public.stock_row_text(l.price_czk, l.quantity, s.keep_qty) end) x
         from jsonb_array_elements(before) b
         left join public.listings l on l.id = (b->>'id')::uuid
         left join public.listing_stock s on s.listing_id = l.id
         left join public.cards c on c.id = (b->>'card_id')::uuid
         limit 20) t);
  return n;
end;
$$;
revoke execute on function public.stock_change(uuid[], text, text, numeric, text, jsonb) from public, anon;
grant execute on function public.stock_change(uuid[], text, text, numeric, text, jsonb) to authenticated;

-- Vrátit změnu z Historie. Ceny, výměna a umístění se vrátí přesně. Kusy se vrátí o to, o kolik je změna změnila,
-- takže co se mezitím prodalo, se znovu nenabídne.
create or replace function public.stock_undo(p_event bigint)
  returns int language plpgsql set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  u jsonb;
  n int;
begin
  select e.undo into u from public.stock_events e
   where e.id = p_event and e.owner_id = uid and e.undone_at is null and e.undo is not null
   for update;
  if u is null then return 0; end if;

  with b as (
    select (x->>'id')::uuid id, (x->>'price_czk')::int price_czk, (x->>'negotiable')::boolean negotiable,
           (x->>'quantity')::int quantity, (x->>'trade_qty')::int trade_qty, x->>'location' location,
           (x->>'total_before')::int tb, (x->>'total_after')::int ta
      from jsonb_array_elements(u) x
  ), cur as (
    select b.*, greatest(0, l.quantity + s.keep_qty - (b.ta - b.tb)) total
      from b join public.listings l on l.id = b.id and l.seller_id = uid and l.removed_at is null and l.hidden_qty is null
      join public.listing_stock s on s.listing_id = l.id
  ), upd as (
    update public.listings l
       set price_czk = cur.price_czk, negotiable = cur.negotiable, quantity = least(cur.quantity, cur.total)
      from cur where l.id = cur.id
    returning l.id, l.quantity, cur.total, cur.trade_qty, cur.location
  )
  update public.listing_stock s
     set keep_qty = upd.total - upd.quantity, trade_qty = least(upd.trade_qty, upd.total), location = upd.location, updated_at = now()
    from upd where s.listing_id = upd.id;
  get diagnostics n = row_count;

  update public.stock_events set undone_at = now() where id = p_event;
  return n;
end;
$$;
revoke execute on function public.stock_undo(bigint) from public, anon;
grant execute on function public.stock_undo(bigint) to authenticated;

-- Tržní cena: poslední průměr z historie cen, jinak nejnižší nabídka.
create or replace function public.stock_market(p_cards uuid[])
  returns table (card_id uuid, market_czk int, low_czk int) language sql stable set search_path = '' as $$
  select c.id,
    (select ph.avg_price_czk from public.price_history ph where ph.card_id = c.id order by ph.day desc limit 1),
    (select min(l.price_czk) from public.listings l
      where l.card_id = c.id and l.quantity > 0 and l.price_czk is not null and l.hidden_qty is null and l.removed_at is null)
  from unnest(p_cards[1:5000]) as c(id)
$$;
grant execute on function public.stock_market(uuid[]) to authenticated;

-- Chybí do sad: sady, ze kterých má přihlášený aspoň jednu kartu.
create or replace function public.stock_sets()
  returns table (set_id uuid, code text, name text, game_id text, owned int, total int)
  language sql stable set search_path = '' as $$
  with mine as (
    select distinct c.set_id, c.id from public.listings l
      join public.listing_stock s on s.listing_id = l.id
      join public.cards c on c.id = l.card_id
     where l.seller_id = (select auth.uid()) and l.quantity + s.keep_qty > 0
  )
  select cs.id, cs.code, cs.name, cs.game_id, count(*)::int,
    (select count(*)::int from public.cards c2 where c2.set_id = cs.id and not c2.hidden)
  from mine m join public.card_sets cs on cs.id = m.set_id
  group by cs.id
$$;
grant execute on function public.stock_sets() to authenticated;

-- Chybějící karty sady s nejlevnější nabídkou.
create or replace function public.stock_set_missing(p_set uuid)
  returns table (card_id uuid, slug text, name text, number text, image_url text, low_czk int, offers int)
  language sql stable set search_path = '' as $$
  select c.id, c.slug, c.name, c.number, c.image_url,
    (select min(l.price_czk) from public.listings l where l.card_id = c.id and l.quantity > 0 and l.price_czk is not null
        and l.hidden_qty is null and l.removed_at is null and l.seller_id <> (select auth.uid())),
    (select count(*)::int from public.listings l where l.card_id = c.id and l.quantity > 0
        and l.hidden_qty is null and l.removed_at is null and l.seller_id <> (select auth.uid()))
  from public.cards c
  where c.set_id = p_set and not c.hidden
    and not exists (select 1 from public.listings l join public.listing_stock s on s.listing_id = l.id
                     where l.card_id = c.id and l.seller_id = (select auth.uid()) and l.quantity + s.keep_qty > 0)
  order by 6 nulls last, c.number
  limit 500
$$;
grant execute on function public.stock_set_missing(uuid) to authenticated;

-- Hledám: hledané karty s nejlevnější nabídkou ve stavu stejném nebo lepším.
create or replace function public.stock_wants_view()
  returns table (card_id uuid, slug text, name text, number text, image_url text, game_id text, set_code text, set_name text,
                 max_price_czk int, min_condition public.card_condition, created_at timestamptz, low_czk int, offers int)
  language sql stable set search_path = '' as $$
  select w.card_id, c.slug, c.name, c.number, c.image_url, c.game_id, cs.code, cs.name, w.max_price_czk, w.min_condition, w.created_at,
    (select min(l.price_czk) from public.listings l where l.card_id = w.card_id and l.quantity > 0 and l.price_czk is not null
        and l.condition <= w.min_condition and l.hidden_qty is null and l.removed_at is null and l.seller_id <> w.user_id),
    (select count(*)::int from public.listings l where l.card_id = w.card_id and l.quantity > 0
        and l.condition <= w.min_condition and l.hidden_qty is null and l.removed_at is null and l.seller_id <> w.user_id)
  from public.stock_wants w
  join public.cards c on c.id = w.card_id
  left join public.card_sets cs on cs.id = c.set_id
  where w.user_id = (select auth.uid())
  order by w.created_at desc
$$;
grant execute on function public.stock_wants_view() to authenticated;

-- Nahrání tabulky / přidání karty: kusy mimo prodej a zdroj řádku skladu (řádek vzniká triggerem při vložení nabídky).
create or replace function public.stock_set_keep(p_rows jsonb)
  returns int language sql set search_path = '' as $$
  with r as (
    select (x->>'id')::uuid id, greatest(0, least(100000, coalesce((x->>'keep')::int, 0))) keep, x->>'source' src
      from jsonb_array_elements(p_rows) x
  ), u as (
    update public.listing_stock s
       set keep_qty = r.keep,
           source = case when r.src in ('manual', 'import', 'photo', 'app') then r.src else s.source end,
           updated_at = now()
      from r where s.listing_id = r.id and s.seller_id = (select auth.uid())
    returning 1
  )
  select count(*)::int from u
$$;
revoke execute on function public.stock_set_keep(jsonb) from public, anon;
grant execute on function public.stock_set_keep(jsonb) to authenticated;
