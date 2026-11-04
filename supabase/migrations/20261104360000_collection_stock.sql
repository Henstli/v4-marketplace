-- Kolekce (alba) berou karty ze skladu (Šimon 4. 11. 2026).
-- Karta v kolekci (collection_cards) drží vždy 1 kus mimo prodej v jednom řádku skladu (listing_id, keep_qty >= 1).
-- Když kus ze skladu zmizí (prodej, odebrání, inventura), kolekce si vezme jiný volný kus, jinak se karta z kolekce vyjme
-- (v albu zůstane prázdné místo). Prodávat jde nejvýš všechny kusy bez toho, který drží kolekce.

alter table public.collection_cards add column if not exists listing_id uuid references public.listings(id) on delete set null;
create index if not exists collection_cards_listing_idx on public.collection_cards (listing_id);
alter table public.collection_albums add column if not exists auto_fill boolean not null default true;
alter table public.card_watches add column if not exists stop_on_have boolean not null default false;
grant update (auto_fill) on public.collection_albums to authenticated;

create or replace function public.collection_cond_rank(c text) returns int
  language sql immutable set search_path = ''
as $$ select coalesce(array_position(array['MT', 'NM', 'EX', 'GD', 'LP', 'PL'], c), 9) $$;

-- Kolik kusů řádku skladu drží kolekce (0 nebo 1).
create or replace function public.collection_held(p_listing uuid) returns int
  language sql stable set search_path = ''
as $$ select count(*)::int from public.collection_cards where listing_id = p_listing $$;

-- Název alba, které kus drží (album sady má přednost), nebo „Kolekce“ u karty mimo alba. null = kolekce kus nedrží.
create or replace function public.collection_label(p_listing uuid) returns text
  language sql stable set search_path = ''
as $$
  select coalesce(
    (select a.name from public.collection_cards cc
       join public.cards c on c.id = cc.card_id
       join public.collection_albums a on a.user_id = cc.user_id
        and ((a.kind = 'set' and a.set_id = c.set_id)
          or (a.kind = 'custom' and exists (select 1 from public.collection_album_cards ac where ac.album_id = a.id and ac.card_id = cc.card_id)))
      where cc.listing_id = p_listing
      order by (a.kind = 'set') desc, a.updated_at desc limit 1),
    (select 'Kolekce' from public.collection_cards where listing_id = p_listing limit 1))
$$;

-- Nejlepší volný kus pro kolekci: mimo prodej, nejlepší stav, přednostně angličtina.
create or replace function public.collection_pick(p_user uuid, p_card uuid) returns uuid
  language sql stable set search_path = ''
as $$
  select l.id from public.listings l join public.listing_stock s on s.listing_id = l.id
   where l.seller_id = p_user and l.card_id = p_card and l.removed_at is null and l.hidden_qty is null and s.keep_qty >= 1
   order by public.collection_cond_rank(l.condition::text), (l.language = 'en') desc, l.created_at
   limit 1
$$;

-- Srovná kartu kolekce se skladem: platný kus nechá, jinak vezme jiný, jinak kartu z kolekce vyjme.
create or replace function public.collection_fix(p_user uuid, p_card uuid) returns void
  language plpgsql set search_path = ''
as $$
declare v uuid;
begin
  if not exists (select 1 from public.collection_cards where user_id = p_user and card_id = p_card) then return; end if;
  if exists (select 1 from public.collection_cards cc
               join public.listings l on l.id = cc.listing_id
               join public.listing_stock s on s.listing_id = l.id
              where cc.user_id = p_user and cc.card_id = p_card and l.removed_at is null and s.keep_qty >= 1) then
    return;
  end if;
  v := public.collection_pick(p_user, p_card);
  if v is not null then
    update public.collection_cards set listing_id = v where user_id = p_user and card_id = p_card;
  else
    delete from public.collection_cards where user_id = p_user and card_id = p_card;
  end if;
end;
$$;

-- Převod dosavadních kolekcí: karta s kusem mimo prodej si ho vezme, ostatní dostanou nový řádek skladu
-- mimo prodej (NM, angličtina; Šimon 4. 11.). Dřív byla kolekce oddělená od skladu, takže jde o další kus.
update public.collection_cards cc set listing_id = public.collection_pick(cc.user_id, cc.card_id), quantity = 1
 where cc.listing_id is null;

do $$
declare r record; v uuid;
begin
  for r in select cc.user_id, cc.card_id from public.collection_cards cc where cc.listing_id is null loop
    insert into public.listings (card_id, seller_id, price_czk, negotiable, condition, language, quantity)
      values (r.card_id, r.user_id, null, true, 'NM', 'en', 0) returning id into v;
    update public.listing_stock set keep_qty = 1, source = 'manual', updated_at = now() where listing_id = v;
    update public.collection_cards set listing_id = v where user_id = r.user_id and card_id = r.card_id;
  end loop;
end $$;

update public.collection_cards set quantity = 1 where quantity <> 1;

-- Hlídání kusu skladu: úbytek mimo prodej srovná kolekci, přírůstek doplní album sady a ukončí hlídání karty.
create or replace function public.collection_stock_sync() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare v_card uuid; v_set uuid; v_user uuid := new.seller_id;
begin
  select l.card_id into v_card from public.listings l where l.id = new.listing_id and l.removed_at is null;
  if v_card is null then return new; end if;
  if tg_op = 'UPDATE' and new.keep_qty < old.keep_qty and exists (select 1 from public.collection_cards where listing_id = new.listing_id) then
    perform public.collection_fix(v_user, v_card);
  end if;
  if new.keep_qty >= 1 and (tg_op = 'INSERT' or new.keep_qty > old.keep_qty) then
    delete from public.card_watches where user_id = v_user and card_id = v_card and stop_on_have;
    if not exists (select 1 from public.collection_cards where user_id = v_user and card_id = v_card) then
      select c.set_id into v_set from public.cards c where c.id = v_card;
      if exists (select 1 from public.collection_albums a where a.user_id = v_user and a.auto_fill
                   and ((a.kind = 'set' and a.set_id = v_set)
                     or (a.kind = 'custom' and exists (select 1 from public.collection_album_cards ac where ac.album_id = a.id and ac.card_id = v_card)))) then
        insert into public.collection_cards (user_id, card_id, listing_id, quantity) values (v_user, v_card, new.listing_id, 1)
          on conflict (user_id, card_id) do nothing;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger listing_stock_collection after insert or update of keep_qty on public.listing_stock
  for each row execute function public.collection_stock_sync();

-- Řádek skladu odebraný nebo smazaný: kolekce si najde jiný kus (smazání nejdřív vynuluje listing_id cizím klíčem).
create or replace function public.collection_listing_gone() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.collection_fix(old.seller_id, old.card_id);
    return old;
  end if;
  if new.removed_at is not null and old.removed_at is null then
    perform public.collection_fix(new.seller_id, new.card_id);
  end if;
  if new.quantity > old.quantity then
    delete from public.card_watches where user_id = new.seller_id and card_id = new.card_id and stop_on_have;
  end if;
  return new;
end;
$$;

create or replace trigger listings_collection after update of removed_at, quantity or delete on public.listings
  for each row execute function public.collection_listing_gone();

-- Vyjmout karty z kolekce (před prodejem posledního kusu). Kus zůstává ve skladu.
create or replace function public.collection_release(p_listings uuid[]) returns int
  language sql set search_path = ''
as $$
  with d as (delete from public.collection_cards where user_id = (select auth.uid()) and listing_id = any(p_listings) returning 1)
  select count(*)::int from d
$$;

-- Vložit karty do kolekce (a do alba). Bere jen kusy ze skladu:
-- kus mimo prodej; s p_unsell i poslední kus z prodeje; s p_cond založí nový kus mimo prodej („Mám ji“).
create or replace function public.collection_put(p_cards uuid[], p_album uuid default null, p_cond text default null,
                                                 p_lang text default null, p_unsell boolean default false) returns jsonb
  language plpgsql set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text;
  v_card uuid;
  v_l uuid;
  v_pos int;
  v_added uuid[] := '{}';
  v_sale uuid[] := '{}';
  v_none uuid[] := '{}';
begin
  if v_uid is null then raise exception 'Přihlaste se' using errcode = '42501'; end if;
  if p_album is not null then
    select kind into v_kind from public.collection_albums where id = p_album and user_id = v_uid;
    if v_kind is null then raise exception 'Album nenalezeno'; end if;
  end if;
  if p_cond is not null and p_cond not in ('MT', 'NM', 'EX', 'GD', 'LP', 'PL') then raise exception 'Neplatný stav'; end if;
  if p_lang is not null and p_lang not in ('en', 'de', 'ja', 'fr', 'it', 'es', 'pt', 'ko', 'zh', 'ru', 'cs') then raise exception 'Neplatný jazyk'; end if;
  for v_card in select c from unnest(coalesce(p_cards, '{}')) with ordinality t(c, o) group by c order by min(o) limit 2000 loop
    if exists (select 1 from public.collection_cards where user_id = v_uid and card_id = v_card and listing_id is not null) then
      v_added := v_added || v_card;
      continue;
    end if;
    v_l := public.collection_pick(v_uid, v_card);
    if v_l is null and p_unsell then
      select l.id into v_l from public.listings l
       where l.seller_id = v_uid and l.card_id = v_card and l.removed_at is null and l.hidden_qty is null and l.quantity >= 1
       order by public.collection_cond_rank(l.condition::text), l.created_at limit 1;
      if v_l is not null then
        update public.listings set quantity = quantity - 1 where id = v_l;
        update public.listing_stock set keep_qty = keep_qty + 1, updated_at = now() where listing_id = v_l;
      end if;
    end if;
    if v_l is null and p_cond is not null then
      insert into public.listings (card_id, seller_id, price_czk, negotiable, condition, language, quantity)
        values (v_card, v_uid, null, true, p_cond::public.card_condition, coalesce(p_lang, 'en'), 0) returning id into v_l;
      update public.listing_stock set keep_qty = 1, source = 'app', updated_at = now() where listing_id = v_l;
    end if;
    if v_l is null then
      if exists (select 1 from public.listings l where l.seller_id = v_uid and l.card_id = v_card and l.removed_at is null and l.quantity >= 1) then
        v_sale := v_sale || v_card;
      else
        v_none := v_none || v_card;
      end if;
      continue;
    end if;
    insert into public.collection_cards (user_id, card_id, listing_id, quantity) values (v_uid, v_card, v_l, 1)
      on conflict (user_id, card_id) do update set listing_id = excluded.listing_id;
    v_added := v_added || v_card;
  end loop;
  if v_kind = 'custom' and cardinality(v_added) > 0 then
    select coalesce(max(position), 0) into v_pos from public.collection_album_cards where album_id = p_album;
    insert into public.collection_album_cards (album_id, card_id, position)
      select p_album, t.c, v_pos + row_number() over (order by t.o)
        from unnest(v_added) with ordinality t(c, o)
       where not exists (select 1 from public.collection_album_cards x where x.album_id = p_album and x.card_id = t.c);
  end if;
  if p_album is not null then
    update public.collection_albums set updated_at = now() where id = p_album;
  end if;
  return jsonb_build_object('added', to_jsonb(v_added), 'onSale', to_jsonb(v_sale), 'missing', to_jsonb(v_none));
end;
$$;

-- Starý vstup: jen přes collection_put (karty mimo sklad se nevloží).
create or replace function public.collection_add(p_cards uuid[], p_album uuid default null) returns int
  language sql set search_path = ''
as $$ select jsonb_array_length(public.collection_put(p_cards, p_album) -> 'added') $$;

grant execute on function public.collection_put(uuid[], uuid, text, text, boolean) to authenticated;
grant execute on function public.collection_release(uuid[]) to authenticated;
grant execute on function public.collection_label(uuid) to authenticated;
grant execute on function public.collection_held(uuid) to authenticated;

-- Na prodej: kus, který drží kolekce, zůstává mimo prodej.
do $$
declare d text; o text := 'update public.listings l set quantity = l.quantity + s.keep_qty
      from public.listing_stock s where s.listing_id = l.id and l.id = any(ids) and s.keep_qty > 0;
    update public.listing_stock set keep_qty = 0, updated_at = now(), listed_at = coalesce(listed_at, now())
     where listing_id = any(ids) and keep_qty > 0;';
begin
  select pg_get_functiondef('public.stock_change(uuid[], text, text, numeric, text, jsonb)'::regprocedure) into d;
  if position(o in d) = 0 then raise exception 'stock_change: větev sell nenalezena'; end if;
  d := replace(d, o, 'update public.listings l set quantity = l.quantity + s.keep_qty - public.collection_held(l.id)
      from public.listing_stock s where s.listing_id = l.id and l.id = any(ids) and s.keep_qty > public.collection_held(l.id);
    update public.listing_stock s2 set keep_qty = public.collection_held(s2.listing_id), updated_at = now(), listed_at = coalesce(s2.listed_at, now())
     where s2.listing_id = any(ids) and s2.keep_qty > public.collection_held(s2.listing_id);');
  execute d;

  -- Sklad ukazuje, který kus drží kolekce (al = název alba).
  select pg_get_functiondef('public.stock_base(uuid, uuid[], uuid, boolean)'::regprocedure) into d;
  if position('''m'', x.market,' in d) = 0 then raise exception 'stock_base: pole m nenalezeno'; end if;
  d := replace(d, '''m'', x.market,', '''m'', x.market, ''al'', public.collection_label(x.id),');
  execute d;
end $$;
