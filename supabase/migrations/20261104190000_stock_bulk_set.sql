-- Sklad podle prototypu: hromadné nastavení řádků jednou změnou (jedna položka v Historii, jde vrátit).
-- p_rows: [{id, quantity?, keep_qty?, price_czk? (null = bez ceny / dohodou), condition?, language?}]
-- Používá: krokování Na prodej u skupiny variant, okno Dát do prodeje, Upravit ceny, Stav a jazyk.
create or replace function public.stock_bulk_set(p_rows jsonb, p_title text, p_kind text default 'stock')
  returns int language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  own uuid;
  ids uuid[];
  before jsonb;
  n int := 0;
  needs text := 'add';
begin
  if uid is null then raise exception 'Nejdřív se přihlaste' using errcode = '42501'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Vyberte karty';
  end if;
  if p_kind not in ('stock', 'price') then raise exception 'Neznámá změna'; end if;
  select l.seller_id into own from public.listings l where l.id = (p_rows->0->>'id')::uuid;
  if own is null then return 0; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where r ? 'quantity' or r ? 'price_czk') then needs := 'price'; end if;
  if not public.stock_perm(own, needs) then raise exception 'Na tuto změnu nemáte právo' using errcode = '42501'; end if;
  ids := array(select l.id from public.listings l
    where l.id in (select (r->>'id')::uuid from jsonb_array_elements(p_rows) r)
      and l.seller_id = own and l.removed_at is null and l.hidden_qty is null);
  if coalesce(array_length(ids, 1), 0) = 0 then return 0; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r
              where (r ? 'quantity' and (r->>'quantity')::int < 0) or (r ? 'keep_qty' and (r->>'keep_qty')::int < 0)
                 or (r ? 'price_czk' and jsonb_typeof(r->'price_czk') <> 'null' and (r->>'price_czk')::int <= 0)
                 or (r ? 'condition' and (r->>'condition') not in ('MT', 'NM', 'EX', 'GD', 'LP', 'PL'))
                 or (r ? 'language' and (r->>'language') not in ('en', 'de', 'ja', 'fr', 'it', 'es', 'pt', 'ko', 'zh', 'ru'))) then
    raise exception 'Neplatná hodnota';
  end if;

  select jsonb_agg(jsonb_build_object('id', l.id, 'card_id', l.card_id, 'price_czk', l.price_czk, 'negotiable', l.negotiable, 'quantity', l.quantity,
      'keep_qty', s.keep_qty, 'trade_qty', s.trade_qty, 'location', s.location))
    into before
    from public.listings l join public.listing_stock s on s.listing_id = l.id
   where l.id = any(ids);

  update public.listings l set
      quantity = case when r ? 'quantity' then (r->>'quantity')::int else l.quantity end,
      price_czk = case when r ? 'price_czk' then (r->>'price_czk')::int else l.price_czk end,
      negotiable = case when r ? 'price_czk' then (r->>'price_czk') is null else l.negotiable end,
      condition = case when r ? 'condition' then (r->>'condition')::public.card_condition else l.condition end,
      language = case when r ? 'language' then r->>'language' else l.language end
    from jsonb_array_elements(p_rows) r
   where l.id = (r->>'id')::uuid and l.id = any(ids);
  update public.listing_stock s set
      keep_qty = case when r ? 'keep_qty' then (r->>'keep_qty')::int else s.keep_qty end,
      updated_at = now()
    from jsonb_array_elements(p_rows) r
   where s.listing_id = (r->>'id')::uuid and s.listing_id = any(ids);
  update public.listing_stock s set listed_at = coalesce(s.listed_at, now())
    from public.listings l where s.listing_id = l.id and l.id = any(ids) and l.quantity > 0;

  -- Víc kusů na prodej jde jen s dopravou a platbou obchodu.
  if exists (select 1 from jsonb_array_elements(before) b join public.listings l on l.id = (b->>'id')::uuid
              where l.quantity > (b->>'quantity')::int)
     and not coalesce(public.seller_ready(own), false) then
    raise exception 'Prodávat jde až s dopravou a platbou' using errcode = '42501';
  end if;
  update public.listing_stock s set trade_qty = l.quantity + s.keep_qty
    from public.listings l where s.listing_id = l.id and l.id = any(ids) and s.trade_qty > l.quantity + s.keep_qty;

  n := coalesce(array_length(ids, 1), 0);
  insert into public.stock_events (owner_id, actor_id, kind, title, undo, sample)
  select own, uid, p_kind, left(coalesce(nullif(trim(p_title), ''), 'Úprava skladu'), 200),
    (select jsonb_agg(b || jsonb_build_object('total_before', (b->>'quantity')::int + (b->>'keep_qty')::int,
                                              'total_after', coalesce(l.quantity + s.keep_qty, 0)))
       from jsonb_array_elements(before) b
       left join public.listings l on l.id = (b->>'id')::uuid
       left join public.listing_stock s on s.listing_id = l.id),
    (select jsonb_agg(x) from (
       select jsonb_build_array(c.name,
                public.stock_row_text((b->>'price_czk')::int, (b->>'quantity')::int, (b->>'keep_qty')::int),
                public.stock_row_text(l.price_czk, l.quantity, s.keep_qty)) x
         from jsonb_array_elements(before) b
         join public.listings l on l.id = (b->>'id')::uuid
         join public.listing_stock s on s.listing_id = l.id
         left join public.cards c on c.id = (b->>'card_id')::uuid
         limit 20) t);
  return n;
end;
$$;
grant execute on function public.stock_bulk_set(jsonb, text, text) to authenticated;

-- Historie jedné karty pro detail: změny skladu, které se týkaly tohoto řádku.
create or replace function public.stock_row_events(p_listing uuid)
  returns table (id bigint, created_at timestamptz, kind text, title text) language sql stable security definer set search_path = '' as $$
  select e.id, e.created_at, e.kind, e.title
    from public.stock_events e
    join public.listings l on l.id = p_listing
   where e.owner_id = l.seller_id and public.stock_perm(l.seller_id, 'view')
     and e.undo @> jsonb_build_array(jsonb_build_object('id', p_listing))
   order by e.created_at desc
   limit 8
$$;
grant execute on function public.stock_row_events(uuid) to authenticated;

-- Chybí do sad podle prototypu: náhled chybějících karet, za kolik jde sadu doplnit a kolik z nich hlídáte.
create or replace function public.stock_sets_extra(p_sets uuid[])
  returns table (set_id uuid, images text[], low_sum int, watched int, missing int)
  language sql stable set search_path = '' as $$
  with miss as (
    select c.set_id, c.id, c.number, c.image_url
      from public.cards c
     where c.set_id = any(p_sets[1:60]) and not c.hidden
       and not exists (select 1 from public.listings l join public.listing_stock s on s.listing_id = l.id
                        where l.card_id = c.id and l.seller_id = (select auth.uid()) and l.quantity + s.keep_qty > 0)
  )
  select m.set_id,
    (array_agg(m.image_url order by m.number) filter (where m.image_url is not null))[1:3],
    coalesce(sum((select min(l.price_czk) from public.listings l where l.card_id = m.id and l.quantity > 0 and l.price_czk is not null
        and l.hidden_qty is null and l.removed_at is null and l.seller_id <> (select auth.uid()))), 0)::int,
    count(*) filter (where exists (select 1 from public.stock_wants w where w.user_id = (select auth.uid()) and w.card_id = m.id))::int,
    count(*)::int
  from miss m
  group by m.set_id
$$;
grant execute on function public.stock_sets_extra(uuid[]) to authenticated;
