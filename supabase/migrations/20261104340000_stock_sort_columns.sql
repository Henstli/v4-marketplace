-- Řazení tabulky skladu kliknutím na nadpis sloupce: Karta (abecedně), Stav (od nejlepšího), Jazyk, Mám (nejvíc),
-- Na prodej (nabízené první), Cena (nejvyšší, bez ceny na konec), Umístění (abecedně, čísla správně, bez umístění na konec).
-- p.dir = 'asc' / 'desc' obrací pořadí (druhé kliknutí); bez něj platí výchozí směr sloupce.

-- Abeceda s čísly podle hodnoty (A2 před A10).
create collation if not exists public.cs_num (provider = icu, locale = 'cs-u-kn-true');

create or replace function public.stock_visible(p_owner uuid, p jsonb)
  returns table (pos int, id uuid, card_id uuid, cond text, lang text, locked boolean, j jsonb)
  language sql stable security definer set search_path = '' as $$
  with f as (
    select coalesce(p->>'mode', 'all') = 'sale' as sale_,
           coalesce((p->>'shop')::boolean, false) as shop_,
           nullif(lower(public.unaccent_immutable(trim(coalesce(p->>'q', '')))), '') as q_,
           array(select jsonb_array_elements_text(coalesce(p->'g', '[]'))) as g_,
           array(select jsonb_array_elements_text(coalesce(p->'c', '[]'))) as c_,
           array(select jsonb_array_elements_text(coalesce(p->'l', '[]'))) as l_,
           array(select jsonb_array_elements_text(coalesce(p->'s', '[]'))) as s_,
           array(select jsonb_array_elements_text(coalesce(p->'p', '[]'))) as p_,
           coalesce(p->>'forSale', '') as fs_,
           coalesce((p->>'attn')::boolean, false) as attn_,
           coalesce((p->>'dup')::boolean, false) as dup_,
           coalesce((p->>'old')::boolean, false) as old_,
           coalesce(p->>'sort', 'chg') as sort_,
           case when jsonb_typeof(p->'fz') = 'object' then p->'fz' else '{}'::jsonb end as fz_
  ), d as (
    -- Výchozí směr: abecedně a od nejlepšího stavu vzestupně, počty a ceny od největších.
    select f.*, coalesce(nullif(p->>'dir', ''),
             case when f.sort_ in ('name', 'cond', 'lang', 'loc') then 'asc' else 'desc' end) = 'asc' as asc_
      from f
  ), k as (
    -- fz: pořadí zamrzlé od zvolení řazení; upravená karta se řadí podle hodnoty před úpravou a neuskočí.
    select i.*, d.asc_,
           case d.sort_
             when 'chg' then extract(epoch from coalesce((d.fz_->>i.id::text)::timestamptz, i.upd))
             when 'have' then coalesce((d.fz_->>i.id::text)::numeric, i.have)
             when 'sale' then coalesce((d.fz_->>i.id::text)::numeric, i.sale)
             when 'price' then coalesce((d.fz_->>i.id::text)::numeric, i.price, i.market, 0)
             when 'cond' then case coalesce(d.fz_->>i.id::text, i.cond)
               when 'MT' then 0 when 'NM' then 1 when 'EX' then 2 when 'GD' then 3 when 'LP' then 4 when 'PL' then 5 else 6 end
             when 'lang' then coalesce(array_position(array['en','de','ja','fr','it','es','pt','ko','zh'], coalesce(d.fz_->>i.id::text, i.lang)), 99)
           end as kn,
           ((d.sort_ = 'loc' and coalesce(d.fz_->>i.id::text, i.loc) = '') or (d.sort_ = 'price' and i.price is null and i.market is null)) as kl,
           case d.sort_
             when 'name' then coalesce(d.fz_->>i.id::text, i.name)
             when 'lang' then coalesce(d.fz_->>i.id::text, i.lang)
             when 'loc' then coalesce(d.fz_->>i.id::text, i.loc)
           end as kt
      from public.stock_base(p_owner, null, null, false) i, d
     where (not d.sale_ or i.sale > 0)
       and (cardinality(d.g_) = 0 or i.game = any(d.g_))
       and (cardinality(d.c_) = 0 or i.cond = any(d.c_))
       and (cardinality(d.l_) = 0 or i.lang = any(d.l_))
       and (cardinality(d.s_) = 0 or i.src = any(d.s_))
       and (cardinality(d.p_) = 0 or exists (select 1 from unnest(d.p_) pl
             where (pl = '—' and i.loc = '') or (pl <> '—' and i.loc <> '' and (i.loc = pl or left(i.loc, length(pl) + 3) = pl || ' · '))))
       and (not d.attn_ or (d.shop_ and public.stock_issue(i.sale, i.price, i.market, i.loc, i.listed)))
       and (not d.dup_ or i.have > 1)
       and (not d.old_ or (i.sale > 0 and i.listed >= 60))
       and (d.fs_ <> 'on' or i.sale > 0)
       and (d.fs_ <> 'off' or i.sale = 0)
       and (d.q_ is null or position(d.q_ in lower(public.unaccent_immutable(i.srch))) > 0)
  )
  -- Karty bez umístění (a při řazení podle ceny karty bez ceny i trhu) zůstávají na konci v obou směrech.
  select row_number() over (order by
           k.kl asc,
           case when k.asc_ then k.kn end asc, case when not k.asc_ then k.kn end desc,
           case when k.asc_ then k.kt end collate public.cs_num asc, case when not k.asc_ then k.kt end collate public.cs_num desc,
           k.ca desc, k.id)::int,
         k.id, k.card_id, k.cond, k.lang, k.locked, k.j
    from k
$$;
