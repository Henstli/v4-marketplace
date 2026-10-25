-- Našeptávač: stejná karta ve stejné sadě (varianty, foil, jiný jazyk) jen jednou, ať se do pár řádků vejde víc různých karet.
create or replace function public.suggest_rank(p_ids uuid[], p_norm text, p_limit int, p_keep_order boolean default false)
returns table (
  slug text, name text, number text, image_url text, game_id text, set_name text, min_price int, offers int
)
language sql stable
set search_path = ''
as $$
  with offers as (
    select l.card_id, min(l.price_czk)::int as min_price, count(*)::int as offers
    from public.listings l
    where l.quantity > 0 and l.card_id = any (p_ids)
    group by l.card_id
  ),
  hits as (
    select c.id, c.set_id, c.slug, c.name, c.number, c.image_url, c.released_on, o.min_price, o.offers,
           regexp_replace(lower(public.unaccent_immutable(c.name)), '[^a-z0-9]+', ' ', 'g') as norm
    from public.cards c
    left join offers o on o.card_id = c.id
    where c.id = any (p_ids)
  ),
  distinct_hits as (
    select h.*, row_number() over (
      partition by h.norm, h.set_id
      order by (h.offers is not null) desc, (h.image_url is not null) desc, h.number, h.id) as rn
    from hits h
  )
  select h.slug, h.name, h.number, h.image_url, s.game_id, s.name, h.min_price, coalesce(h.offers, 0)
  from distinct_hits h
  join public.card_sets s on s.id = h.set_id
  where h.rn = 1
  order by
    -- U hledání s překlepem jsou kandidáti už seřazení podle podobnosti.
    case when p_keep_order then array_position(p_ids, h.id) end,
    (h.norm = p_norm) desc,
    (h.norm like p_norm || '%') desc,
    (h.offers is not null) desc,
    (h.image_url is not null) desc,
    h.released_on desc nulls last,
    h.name,
    h.id
  limit p_limit
$$;
