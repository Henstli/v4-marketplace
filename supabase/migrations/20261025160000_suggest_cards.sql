-- Našeptávač ve vyhledávání: pár nejpodobnějších karet už při psaní.
-- Kandidáti se berou z fulltextového indexu (začátky slov, bez diakritiky) v pořadí katalogu, takže i krátký
-- dotaz přečte jen pár desítek řádků. Když žádná karta neodpovídá, hledá se podle podobnosti (překlepy) přes pg_trgm.
-- Security definer ze stejného důvodu jako search_cards: RLS by indexům zabránilo, skryté karty vylučujeme sami.

create extension if not exists pg_trgm with schema extensions;

create index if not exists cards_name_trgm_idx
  on public.cards using gin (lower(public.unaccent_immutable(name)) extensions.gin_trgm_ops) where not hidden;

-- Seřadí kandidáty našeptávače (jen pro suggest_cards): celý název, název začínající dotazem, s nabídkou, s obrázkem, novější.
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
    select c.*, regexp_replace(lower(public.unaccent_immutable(c.name)), '[^a-z0-9]+', ' ', 'g') as norm
    from public.cards c
    where c.id = any (p_ids)
  )
  select h.slug, h.name, h.number, h.image_url, s.game_id, s.name, o.min_price, coalesce(o.offers, 0)
  from hits h
  join public.card_sets s on s.id = h.set_id
  left join offers o on o.card_id = h.id
  order by
    -- U hledání s překlepem jsou kandidáti už seřazení podle podobnosti.
    case when p_keep_order then array_position(p_ids, h.id) end,
    (h.norm = p_norm) desc,
    (h.norm like p_norm || '%') desc,
    (o.offers is not null) desc,
    (h.image_url is not null) desc,
    h.released_on desc nulls last,
    h.name,
    h.id
  limit p_limit
$$;

revoke execute on function public.suggest_rank(uuid[], text, int, boolean) from public, anon, authenticated;

create or replace function public.suggest_cards(
  p_q text,
  p_game text default null,
  p_limit int default 6
) returns table (
  slug text, name text, number text, image_url text, game_id text, set_name text, min_price int, offers int
)
language plpgsql stable security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_norm text := trim(regexp_replace(lower(public.unaccent_immutable(coalesce(p_q, ''))), '[^a-z0-9]+', ' ', 'g'));
  v_tsq tsquery;
  v_limit int := least(greatest(coalesce(p_limit, 6), 1), 10);
begin
  if length(v_norm) < 2 then
    return;
  end if;
  select to_tsquery('simple', string_agg(w || ':*', ' & ')) into v_tsq
  from regexp_split_to_table(v_norm, ' ') w
  where w <> '';

  return query
  with cand as (
    -- Karty, které někdo prodává (malá množina).
    select c.id
    from public.cards c
    where not c.hidden
      and (p_game is null or c.game_id = p_game)
      and c.search @@ v_tsq
      and exists (select 1 from public.listings l where l.card_id = c.id and l.quantity > 0)
    union
    -- Nejnovější karty s obrázkem v pořadí indexu katalogu, ať krátký dotaz nečte tisíce řádků.
    (select c.id
     from public.cards c
     where not c.hidden
       and (p_game is null or c.game_id = p_game)
       and c.search @@ v_tsq
     order by (c.image_url is not null) desc, c.released_on desc nulls last, c.name, c.id
     limit 60)
  )
  select r.slug, r.name, r.number, r.image_url, r.game_id, r.set_name, r.min_price, r.offers
  from public.suggest_rank(array(select id from cand), v_norm, v_limit) r;

  if found or length(v_norm) < 3 then
    return;
  end if;

  -- Nic nenašlo: nejspíš překlep. Podobnost slov názvu s dotazem (trigramy).
  perform set_config('pg_trgm.word_similarity_threshold', '0.45', true);
  return query
  select r.slug, r.name, r.number, r.image_url, r.game_id, r.set_name, r.min_price, r.offers
  from public.suggest_rank(array(
    select c.id
    from public.cards c
    where not c.hidden
      and (p_game is null or c.game_id = p_game)
      and v_norm operator(extensions.<%) lower(public.unaccent_immutable(c.name))
    order by extensions.word_similarity(v_norm, lower(public.unaccent_immutable(c.name))) desc, c.id
    limit 60
  ), v_norm, v_limit, true) r;
end;
$$;

revoke execute on function public.suggest_cards(text, text, int) from public;
grant execute on function public.suggest_cards(text, text, int) to anon, authenticated;
