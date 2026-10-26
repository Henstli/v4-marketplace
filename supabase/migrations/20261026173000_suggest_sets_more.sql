-- Sad se stejným začátkem názvu bývá i přes 30 (Duel Decks, Starter Deck), suggest_groups jich proto vrací až 40.
-- Našeptávač ukáže 4, katalog 8 a zbytek po kliknutí na „Zobrazit všech N sad“.

create or replace function public.suggest_groups(p_q text, p_game text default null)
returns table (
  kind text, ref text, name text, game_id text, code text, released_on date, items int,
  seller_kind text, country text, positive int
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_norm text := trim(regexp_replace(lower(public.unaccent_immutable(coalesce(p_q, ''))), '[^a-z0-9]+', ' ', 'g'));
  v_tsq tsquery;
begin
  if length(v_norm) < 2 then
    return;
  end if;
  select to_tsquery('simple', string_agg(w || ':*', ' & ')) into v_tsq
  from regexp_split_to_table(v_norm, ' ') w
  where w <> '';

  -- Sady: název, kód (OBF, MH3) nebo rok vydání („lorwyn 2007“). Sad je pár stovek, index nepotřebují.
  return query
  select 'set', s.id::text, s.name, s.game_id, s.code, s.released_on,
         (select count(*)::int from public.cards c where c.set_id = s.id and not c.hidden),
         null::text, null::text, null::int
  from public.card_sets s
  where (p_game is null or s.game_id = p_game)
    and to_tsvector('simple', regexp_replace(lower(public.unaccent_immutable(s.name || ' ' || s.code || ' ' || coalesce(extract(year from s.released_on)::text, ''))), '[^a-z0-9]+', ' ', 'g')) @@ v_tsq
    and exists (select 1 from public.cards c where c.set_id = s.id and not c.hidden)
  -- Přesná shoda názvu před novějšími sadami se stejným začátkem (Lorwyn před Lorwyn Eclipsed).
  order by (lower(s.code) = v_norm) desc,
           (regexp_replace(lower(public.unaccent_immutable(s.name)), '[^a-z0-9]+', ' ', 'g') = v_norm) desc,
           (regexp_replace(lower(public.unaccent_immutable(s.name)), '[^a-z0-9]+', ' ', 'g') like v_norm || '%') desc,
           s.released_on desc nulls last, s.name
  -- Našeptávač ukáže první čtyři, katalog osm a na požádání všechny.
  limit 40;

  -- Prodejci, kteří mají něco v nabídce. Kladná hodnocení = 4 a 5 hvězdiček.
  return query
  select 'seller', p.id::text, p.display_name, null::text, null::text, null::date,
         (select count(*)::int from public.listings l where l.seller_id = p.id and l.quantity > 0),
         p.kind::text, p.country,
         (select round(100.0 * count(*) filter (where r.rating >= 4) / nullif(count(*), 0))::int
          from public.reviews r where r.seller_id = p.id)
  from public.profiles p
  where to_tsvector('simple', regexp_replace(lower(public.unaccent_immutable(p.display_name)), '[^a-z0-9]+', ' ', 'g')) @@ v_tsq
    and exists (select 1 from public.listings l where l.seller_id = p.id and l.quantity > 0)
  order by (regexp_replace(lower(public.unaccent_immutable(p.display_name)), '[^a-z0-9]+', ' ', 'g') like v_norm || '%') desc,
           (p.kind = 'shop') desc, p.display_name
  limit 3;
end;
$$;

revoke execute on function public.suggest_groups(text, text) from public;
grant execute on function public.suggest_groups(text, text) to anon, authenticated;
