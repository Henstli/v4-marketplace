-- Rychlejší načtení skladu: celý sklad i s tržními cenami jedním dotazem místo až 10 stránek po 1000
-- (stránkování přes offset počítalo připojené karty pro všechny přeskočené řádky znovu) a dalších volání stock_market.
-- Práva stejná jako dosud přes RLS: majitel nebo člen týmu s právem 'view' (stock_perm); skryté karty bez údajů karty.
create or replace function public.stock_load(p_owner uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(r order by r.ca desc, r.id), '[]'::jsonb) from (
    select l.id, l.card_id as cid, l.price_czk as p, l.condition as co, l.language as la, l.quantity as q,
           l.hidden_qty as h, (l.removed_at is not null) as rm, l.created_at as ca,
           s.keep_qty as k, s.trade_qty as t, s.location as lo, s.buy_price_czk as b, s.listed_at as li, s.source as so, s.updated_at as u,
           case when c.id is not null then jsonb_build_object('slug', c.slug, 'name', c.name, 'number', c.number, 'image', c.image_url,
             'game', c.game_id, 'code', cs.code, 'set', cs.name) end as c,
           coalesce(
             (select ph.avg_price_czk from public.price_history ph where ph.card_id = l.card_id order by ph.day desc limit 1),
             (select min(m.price_czk) from public.listings m
               where m.card_id = l.card_id and m.quantity > 0 and m.price_czk is not null and m.hidden_qty is null and m.removed_at is null)
           ) as m
      from public.listings l
      left join public.listing_stock s on s.listing_id = l.id
      left join public.cards c on c.id = l.card_id and not c.hidden
      left join public.card_sets cs on cs.id = c.set_id
     where l.seller_id = p_owner and public.stock_perm(p_owner, 'view')
     limit 20000
  ) r
$$;
grant execute on function public.stock_load(uuid) to authenticated;
