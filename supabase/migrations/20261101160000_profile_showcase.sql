-- Celý profil na hrací podložce (DS Trezor › ProfileMat, deska P5):
-- alba na profilu (jdou skrýt), chybějící karty z alba sady, poslední obchody, hodnocení a doba odpovědi.
-- Nic se nemaže: nový sloupec a nová funkce jen pro čtení.

alter table public.collection_albums add column if not exists on_profile boolean not null default true;

create or replace function public.profile_showcase(p_user uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_albums jsonb;
  v_missing jsonb;
  v_trades jsonb;
  v_reviews jsonb;
  v_sales int;
  v_reply numeric;
  v_set uuid;
  v_album record;
begin
  -- Alba, která majitel neskryl: nejnověji upravená první, nejvýš 8
  select coalesce(jsonb_agg(x order by x.updated_at desc), '[]') into v_albums from (
    select a.id, a.name, a.design, a.kind, a.updated_at, s.name as set_name, s.code as set_code,
      case when a.kind = 'set' then
        (select count(*) from public.cards c where c.set_id = a.set_id and not c.hidden)
      else (select count(*) from public.collection_album_cards ac where ac.album_id = a.id) end as total,
      case when a.kind = 'set' then
        (select count(*) from public.cards c join public.collection_cards cc on cc.card_id = c.id and cc.user_id = p_user
          where c.set_id = a.set_id and not c.hidden)
      else (select count(*) from public.collection_album_cards ac join public.collection_cards cc on cc.card_id = ac.card_id and cc.user_id = p_user
          where ac.album_id = a.id) end as have
    from public.collection_albums a
    left join public.card_sets s on s.id = a.set_id
    where a.user_id = p_user and a.on_profile
    order by a.updated_at desc
    limit 8
  ) x;

  -- Chybí do sady: první viditelné album sady, kterému něco chybí
  for v_album in
    select a.id, a.name, a.design, a.set_id from public.collection_albums a
    where a.user_id = p_user and a.on_profile and a.kind = 'set'
    order by a.updated_at desc
  loop
    if exists (select 1 from public.cards c where c.set_id = v_album.set_id and not c.hidden
               and not exists (select 1 from public.collection_cards cc where cc.user_id = p_user and cc.card_id = c.id)) then
      v_set := v_album.set_id;
      select jsonb_build_object(
        'album', jsonb_build_object('id', v_album.id, 'name', v_album.name, 'design', v_album.design),
        'count', (select count(*) from public.cards c where c.set_id = v_set and not c.hidden
                  and not exists (select 1 from public.collection_cards cc where cc.user_id = p_user and cc.card_id = c.id)),
        'cards', coalesce((select jsonb_agg(m) from (
          select c.slug, c.name, c.number, c.image_url as image
          from public.cards c
          where c.set_id = v_set and not c.hidden
            and not exists (select 1 from public.collection_cards cc where cc.user_id = p_user and cc.card_id = c.id)
          order by (exists (select 1 from public.listings l where l.card_id = c.id and l.removed_at is null and l.quantity > 0)) desc,
                   length(c.number), c.number
          limit 2) m), '[]')
      ) into v_missing;
      exit;
    end if;
  end loop;

  -- Poslední obchody: doručené objednávky jako prodejce i kupující
  select coalesce(jsonb_agg(t order by t.at desc), '[]') into v_trades from (
    select o.id, (o.seller_id = p_user) as sold, coalesce(o.delivered_at, o.closed_at, o.created_at) as at,
      p.display_name as other,
      (select c.name from public.order_items i join public.cards c on c.id = i.card_id where i.order_id = o.id order by i.price_czk desc limit 1) as card,
      (select c.image_url from public.order_items i join public.cards c on c.id = i.card_id where i.order_id = o.id order by i.price_czk desc limit 1) as image,
      (select count(*) from public.order_items i where i.order_id = o.id) as items,
      (select r.rating from public.reviews r where r.order_id = o.id and r.hidden_at is null) as rating
    from public.orders o
    left join public.profiles p on p.id = case when o.seller_id = p_user then o.buyer_id else o.seller_id end
    where (o.seller_id = p_user or o.buyer_id = p_user) and o.status = 'delivered'
    order by coalesce(o.delivered_at, o.closed_at, o.created_at) desc
    limit 3
  ) t;

  -- Hodnocení: poslední dvě s textem
  select coalesce(jsonb_agg(r), '[]') into v_reviews from (
    select rv.rating, rv.comment, p.display_name as author, rv.created_at
    from public.reviews rv
    join public.orders o on o.id = rv.order_id
    left join public.profiles p on p.id = o.buyer_id
    where rv.seller_id = p_user and rv.hidden_at is null and coalesce(btrim(rv.comment), '') <> ''
    order by rv.created_at desc
    limit 2
  ) r;

  select count(*) into v_sales from public.orders o where o.seller_id = p_user and o.status = 'delivered';

  -- Doba odpovědi: medián minut mezi zprávou druhé strany a odpovědí za posledních 90 dní (aspoň 3 odpovědi)
  select case when count(*) >= 3 then percentile_cont(0.5) within group (order by extract(epoch from d) / 60) end into v_reply
  from (
    select m.created_at - lag(m.created_at) over w as d,
           m.sender_id, lag(m.sender_id) over w as prev_sender, lag(m.kind) over w as prev_kind
    from public.messages m
    join public.conversations cv on cv.id = m.conversation_id
    where (cv.user_a = p_user or cv.user_b = p_user) and m.created_at > now() - interval '90 days'
    window w as (partition by m.conversation_id order by m.id)
  ) z
  where z.sender_id = p_user and z.prev_sender is not null and z.prev_sender <> p_user and z.prev_kind = 'text';

  return jsonb_build_object('albums', v_albums, 'missing', v_missing, 'trades', v_trades, 'reviews', v_reviews,
                            'sales', v_sales, 'replyMinutes', v_reply);
end $$;

grant execute on function public.profile_showcase(uuid) to anon, authenticated;
