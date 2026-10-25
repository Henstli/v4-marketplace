// Import katalogů karet do databáze.
//   Pokémon: TCGdex (https://tcgdex.dev), Magic: Scryfall (https://scryfall.com/docs/api).
// Volá ho plánovač v databázi (pg_cron) s hlavičkou x-import-secret (heslo je ve Vaultu jako import_secret).
//   { "mode": "discover" }  doplní seznam sad do catalog_sources
//   { "mode": "next" }      naimportuje jednu sadu, která ještě nebyla nebo je starší než 7 dní
//   { "mode": "set", "game": "magic", "id": "dmu" }  naimportuje konkrétní sadu
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const HEADERS = { 'User-Agent': 'V4market/0.1 (katalog karet)', Accept: 'application/json' };
// Pokémon: celá éra Scarlet & Violet a Evolving Skies (je v ukázkových datech).
const POKEMON_SERIES = ['sv'];
const POKEMON_EXTRA_SETS = ['swsh7'];
// Magic: papírové sady od roku 2023 a pár starších oblíbených.
const MAGIC_SINCE = '2023-01-01';
const MAGIC_TYPES = ['expansion', 'core', 'masters', 'draft_innovation'];
const MAGIC_EXTRA_SETS = ['dmu', 'ltr', 'mh2'];

interface ImportedCard {
  slug: string;
  name: string;
  number: string;
  rarity: string | null;
  image_url: string | null;
  external_id: string;
}

interface ImportedSet {
  code: string;
  name: string;
  released_on: string | null;
  cards: ImportedCard[];
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'object' ? JSON.stringify(e) : String(e);
}

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${res.status} ${url}`);
  }
}

function slugify(...parts: string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---------- Pokémon (TCGdex) ----------

interface TcgdexSetBrief { id: string; name: string }
interface TcgdexSet {
  id: string;
  name: string;
  releaseDate?: string;
  abbreviation?: { official?: string };
  cardCount: { official: number; total: number };
  cards: Array<{ id: string; localId: string; name: string; image?: string }>;
}

async function discoverPokemon(): Promise<Array<{ id: string; name: string }>> {
  const sets: Array<{ id: string; name: string }> = [];
  for (const serie of POKEMON_SERIES) {
    const s = await getJson<{ sets: TcgdexSetBrief[] }>(`https://api.tcgdex.net/v2/en/series/${serie}`);
    sets.push(...s.sets.map((x) => ({ id: x.id, name: x.name })));
  }
  for (const id of POKEMON_EXTRA_SETS) {
    const s = await getJson<TcgdexSet>(`https://api.tcgdex.net/v2/en/sets/${id}`);
    sets.push({ id: s.id, name: s.name });
  }
  return sets;
}

async function fetchPokemonSet(id: string): Promise<ImportedSet> {
  const set = await getJson<TcgdexSet>(`https://api.tcgdex.net/v2/en/sets/${id}`);
  const code = (set.abbreviation?.official || set.id).toUpperCase();
  const rarities = await mapLimit(set.cards, 8, async (c) => {
    try {
      return (await getJson<{ rarity?: string }>(`https://api.tcgdex.net/v2/en/cards/${c.id}`)).rarity ?? null;
    } catch {
      return null;
    }
  });
  return {
    code,
    name: set.name,
    released_on: set.releaseDate ?? null,
    cards: set.cards.map((c, i) => {
      const number = `${c.localId}/${set.cardCount.official}`;
      return {
        slug: slugify(c.name, code, number),
        name: c.name,
        number,
        rarity: rarities[i],
        image_url: c.image ? `${c.image}/high.webp` : null,
        external_id: `tcgdex:${c.id}`,
      };
    }),
  };
}

// ---------- Magic (Scryfall) ----------

interface ScryfallSet { code: string; name: string; released_at?: string; set_type: string; digital: boolean; card_count: number }
interface ScryfallCard {
  id: string;
  name: string;
  collector_number: string;
  rarity: string;
  image_uris?: { normal?: string };
  card_faces?: Array<{ image_uris?: { normal?: string } }>;
}

const MAGIC_RARITY: Record<string, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic', special: 'Special', bonus: 'Bonus' };

async function discoverMagic(): Promise<Array<{ id: string; name: string; released_on?: string }>> {
  const { data } = await getJson<{ data: ScryfallSet[] }>('https://api.scryfall.com/sets');
  return data
    .filter((s) => !s.digital && s.card_count > 0)
    .filter((s) => MAGIC_EXTRA_SETS.includes(s.code) || (MAGIC_TYPES.includes(s.set_type) && (s.released_at ?? '') >= MAGIC_SINCE))
    .filter((s) => (s.released_at ?? '') <= new Date().toISOString().slice(0, 10))
    .map((s) => ({ id: s.code, name: s.name, released_on: s.released_at }));
}

async function fetchMagicSet(code: string): Promise<ImportedSet> {
  const set = await getJson<ScryfallSet>(`https://api.scryfall.com/sets/${code}`);
  const cards: ScryfallCard[] = [];
  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`e:${code}`)}&unique=prints&order=set`;
  while (url) {
    const page: { data: ScryfallCard[]; has_more: boolean; next_page?: string } = await getJson(url);
    cards.push(...page.data);
    url = page.has_more && page.next_page ? page.next_page : null;
    await new Promise((r) => setTimeout(r, 120)); // Scryfall žádá max. 10 dotazů za sekundu
  }
  const upper = code.toUpperCase();
  return {
    code: upper,
    name: set.name,
    released_on: set.released_at ?? null,
    cards: cards.map((c) => ({
      slug: slugify(c.name, upper, c.collector_number),
      name: c.name,
      number: c.collector_number,
      rarity: MAGIC_RARITY[c.rarity] ?? c.rarity,
      image_url: c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal ?? null,
      external_id: `scryfall:${c.id}`,
    })),
  };
}

// ---------- Zápis do databáze ----------

async function save(game: string, set: ImportedSet): Promise<number> {
  const { data: cardSet, error: setError } = await supabase
    .from('card_sets')
    .upsert({ game_id: game, code: set.code, name: set.name, released_on: set.released_on }, { onConflict: 'game_id,code' })
    .select('id')
    .single();
  if (setError) throw setError;

  // Stejný slug u karty jiné hry nepřepisovat, takovou kartu odlišíme koncovkou.
  const unique = new Map<string, ImportedCard>();
  for (const c of set.cards) unique.set(c.slug, c);
  const slugs = [...unique.keys()];
  const taken = new Set<string>();
  for (let i = 0; i < slugs.length; i += 200) {
    const { data } = await supabase
      .from('cards')
      .select('slug, card_sets!inner(game_id)')
      .in('slug', slugs.slice(i, i + 200))
      .neq('card_sets.game_id', game);
    for (const row of data ?? []) taken.add(row.slug);
  }

  const rows = [...unique.values()].map((c) => ({
    ...c,
    slug: taken.has(c.slug) ? `${c.slug}-${game}` : c.slug,
    set_id: cardSet.id,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('cards').upsert(rows.slice(i, i + 500), { onConflict: 'slug' });
    if (error) throw error;
  }
  return rows.length;
}

async function importSet(game: string, id: string): Promise<number> {
  try {
    const set = game === 'pokemon' ? await fetchPokemonSet(id) : await fetchMagicSet(id);
    const count = await save(game, set);
    await supabase
      .from('catalog_sources')
      .update({ imported_at: new Date().toISOString(), cards_imported: count, last_error: null })
      .match({ game_id: game, source_set_id: id });
    return count;
  } catch (e) {
    await supabase
      .from('catalog_sources')
      .update({ imported_at: new Date().toISOString(), last_error: describe(e).slice(0, 500) })
      .match({ game_id: game, source_set_id: id });
    throw e;
  }
}

Deno.serve(async (req) => {
  const { data: allowed } = await supabase.rpc('check_import_secret', { candidate: req.headers.get('x-import-secret') ?? '' });
  if (allowed !== true) return new Response('Forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  try {
    if (body.mode === 'discover') {
      const [pokemon, magic] = await Promise.all([discoverPokemon(), discoverMagic()]);
      const rows = [
        ...pokemon.map((s) => ({ game_id: 'pokemon', source_set_id: s.id, name: s.name })),
        ...magic.map((s) => ({ game_id: 'magic', source_set_id: s.id, name: s.name, released_on: s.released_on ?? null })),
      ];
      const { error } = await supabase.from('catalog_sources').upsert(rows, { onConflict: 'game_id,source_set_id', ignoreDuplicates: true });
      if (error) throw error;
      return json({ discovered: rows.length });
    }

    if (body.mode === 'set') return json({ imported: await importSet(body.game, body.id) });

    // Režim next: nejdřív sady, které ještě nebyly, pak ty starší než 7 dní.
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: next } = await supabase
      .from('catalog_sources')
      .select('game_id, source_set_id')
      .or(`imported_at.is.null,imported_at.lt.${weekAgo}`)
      .order('imported_at', { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle();
    if (!next) return json({ idle: true });
    // Sadu si zabereme předem: kdyby import nedoběhl (limit času funkce), plánovač na ní neuvízne
    // a chyba zůstane vidět v last_error.
    await supabase
      .from('catalog_sources')
      .update({ imported_at: new Date().toISOString(), last_error: 'Import nedoběhl do konce' })
      .match({ game_id: next.game_id, source_set_id: next.source_set_id });
    return json({ set: next.source_set_id, imported: await importSet(next.game_id, next.source_set_id) });
  } catch (e) {
    return json({ error: describe(e) }, 500);
  }
});
