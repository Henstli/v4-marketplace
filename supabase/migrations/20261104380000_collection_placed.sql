-- Album sady bez automatického doplňování ukazuje jen karty, které do něj uživatel vložil
-- (kolekce je společná: jiné album téže sady se zapnutým doplňováním by mu jinak karty přidávalo).
-- Vložené karty takového alba se zapisují do collection_album_cards jako u vlastního alba.

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
  v_auto boolean := true;
begin
  if v_uid is null then raise exception 'Přihlaste se' using errcode = '42501'; end if;
  if p_album is not null then
    select kind, auto_fill into v_kind, v_auto from public.collection_albums where id = p_album and user_id = v_uid;
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
  if (v_kind = 'custom' or (v_kind = 'set' and not v_auto)) and cardinality(v_added) > 0 then
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

-- Přepnutí doplňování: při vypnutí se u alba sady zapamatují karty, které teď ukazuje.
create or replace function public.collection_album_autofill(p_album uuid, p_on boolean) returns void
  language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_kind text; v_set uuid; v_pos int;
begin
  select kind, set_id into v_kind, v_set from public.collection_albums where id = p_album and user_id = v_uid;
  if v_kind is null then raise exception 'Album nenalezeno'; end if;
  update public.collection_albums set auto_fill = p_on, updated_at = now() where id = p_album;
  if not p_on and v_kind = 'set' then
    select coalesce(max(position), 0) into v_pos from public.collection_album_cards where album_id = p_album;
    insert into public.collection_album_cards (album_id, card_id, position)
      select p_album, cc.card_id, v_pos + row_number() over (order by cc.added_at)
        from public.collection_cards cc join public.cards c on c.id = cc.card_id
       where cc.user_id = v_uid and c.set_id = v_set
         and not exists (select 1 from public.collection_album_cards x where x.album_id = p_album and x.card_id = cc.card_id);
  end if;
end;
$$;
grant execute on function public.collection_album_autofill(uuid, boolean) to authenticated;

-- Stávající alba sad s vypnutým doplňováním: vložené jsou karty, které byly v kolekci do minuty po založení alba.
insert into public.collection_album_cards (album_id, card_id, position)
  select a.id, cc.card_id, row_number() over (partition by a.id order by cc.added_at)
    from public.collection_albums a
    join public.collection_cards cc on cc.user_id = a.user_id and cc.added_at <= a.created_at + interval '1 minute'
    join public.cards c on c.id = cc.card_id and c.set_id = a.set_id
   where a.kind = 'set' and not a.auto_fill
     and not exists (select 1 from public.collection_album_cards x where x.album_id = a.id and x.card_id = cc.card_id);
