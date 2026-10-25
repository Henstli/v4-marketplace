// Import katalogů karet do databáze.
//   Pokémon: TCGdex (https://tcgdex.dev), Magic: Scryfall (https://scryfall.com/docs/api),
//   Riftbound: Riftcodex (https://riftcodex.com/docs), Lorcana: Lorcast (https://lorcast.com/docs/api),
//   One Piece: OPTCG API (https://optcgapi.com/documentation).
// Volá ho plánovač v databázi (pg_cron) s hlavičkou x-import-secret (heslo je ve Vaultu jako import_secret).
//   { "mode": "discover" }  doplní seznam sad do catalog_sources
//   { "mode": "next" }      importuje sady, které ještě nebyly nebo jsou starší než 7 dní (kolik stihne za ~40 s)
//   { "mode": "set", "game": "magic", "id": "dmu" }  naimportuje konkrétní sadu
//   { "mode": "discover", "games": ["lorcana"] }  jen vybrané hry
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const HEADERS = { 'User-Agent': 'V4cards/0.1 (katalog karet)', Accept: 'application/json' };
// Pokémon: všechny série kromě digitální TCG Pocket.
const POKEMON_SKIP_SERIES = ['tcgp'];
// Magic: všechny papírové sady kromě tokenů, art karet a podobných doplňků, které se neprodávají jako karty.
const MAGIC_SKIP_TYPES = ['token', 'memorabilia', 'minigame', 'alchemy', 'treasure_chest', 'vanguard'];
// Režim next zpracuje víc sad za sebou, dokud nevyprší tento čas (plánovač ho volá každou minutu).
const NEXT_BUDGET_MS = 40_000;

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

class NotFound extends Error {}

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 404) throw new NotFound(`404 ${url}`);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, (res.status === 429 ? 5000 : 1000) * (attempt + 1)));
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

interface TcgdexBrief { id: string; name: string }
interface TcgdexSet {
  id: string;
  name: string;
  releaseDate?: string;
  abbreviation?: { official?: string };
  cardCount: { official?: number; total?: number };
  cards: Array<{ id: string; localId: string; name: string; image?: string }>;
}

async function discoverPokemon(): Promise<DiscoveredSet[]> {
  const series = await getJson<TcgdexBrief[]>('https://api.tcgdex.net/v2/en/series');
  const sets: Array<{ id: string; name: string }> = [];
  for (const serie of series.filter((x) => !POKEMON_SKIP_SERIES.includes(x.id))) {
    const s = await getJson<{ sets: TcgdexBrief[] }>(`https://api.tcgdex.net/v2/en/series/${serie.id}`);
    sets.push(...s.sets.map((x) => ({ id: x.id, name: x.name })));
  }
  return sets;
}

// Záložní obrázky z pokemontcg.io: TCGdex nemá obrázky třeba u Trainer Gallery, Shiny Vault nebo promo karet.
// Sadu hledáme podle názvu, jinak podle id TCGdex bez teček (svp, sve).
let ptcgSets: Map<string, string> | null = null;
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const numberKey = (s: string) => s.toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1');

async function ptcgImages(setId: string, setName: string): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  if (!ptcgSets) {
    try {
      const { data } = await getJson<{ data: Array<{ id: string; name: string }> }>(
        'https://api.pokemontcg.io/v2/sets?select=id,name&pageSize=250',
      );
      ptcgSets = new Map(data.map((s) => [nameKey(s.name), s.id]));
    } catch {
      // Seznam sad občas spadne, pak zkusíme aspoň id z TCGdex.
    }
  }
  try {
    const ptcgId = ptcgSets?.get(nameKey(setName)) ?? setId.replace(/\./g, '');
    for (let page = 1; ; page++) {
      const res = await getJson<{ data: Array<{ number: string; images?: { large?: string } }>; totalCount: number }>(
        `https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(ptcgId)}&select=number,images&pageSize=250&page=${page}`,
      );
      for (const c of res.data) if (c.images?.large) images.set(numberKey(c.number), c.images.large);
      if (page * 250 >= res.totalCount) break;
    }
  } catch {
    // Záložní zdroj je jen doplněk; bez něj karta zůstane se zástupnou plochou.
  }
  return images;
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
  const fallback = set.cards.some((c) => !c.image) ? await ptcgImages(set.id, set.name) : new Map<string, string>();
  return {
    code,
    name: set.name,
    released_on: set.releaseDate ?? null,
    cards: set.cards.map((c, i) => {
      const number = set.cardCount.official ? `${c.localId}/${set.cardCount.official}` : c.localId;
      return {
        slug: slugify(c.name, code, number),
        name: c.name,
        number,
        rarity: rarities[i],
        image_url: c.image ? `${c.image}/high.webp` : fallback.get(numberKey(c.localId)) ?? null,
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

// Scryfall povoluje u vyhledávání nejvýš 2 dotazy za sekundu, proto mezi jeho dotazy držíme odstup.
let lastScryfall = 0;
async function scryfall<T>(url: string): Promise<T> {
  const wait = lastScryfall + 600 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastScryfall = Date.now();
  return getJson<T>(url);
}

const MAGIC_RARITY: Record<string, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic', special: 'Special', bonus: 'Bonus' };

async function discoverMagic(): Promise<DiscoveredSet[]> {
  const { data } = await scryfall<{ data: ScryfallSet[] }>('https://api.scryfall.com/sets');
  return data
    .filter((s) => !s.digital && s.card_count > 0 && !MAGIC_SKIP_TYPES.includes(s.set_type))
    .filter((s) => (s.released_at ?? '') <= new Date().toISOString().slice(0, 10))
    .map((s) => ({ id: s.code, name: s.name, released_on: s.released_at }));
}

async function fetchMagicSet(code: string): Promise<ImportedSet> {
  const set = await scryfall<ScryfallSet>(`https://api.scryfall.com/sets/${code}`);
  const cards: ScryfallCard[] = [];
  let url: string | null =
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`e:${code}`)}&unique=prints&order=set&include_extras=true&include_variations=true`;
  while (url) {
    let page: { data: ScryfallCard[]; has_more: boolean; next_page?: string };
    try {
      page = await scryfall(url);
    } catch (e) {
      if (e instanceof NotFound) break; // sada bez karet, které vyhledávání vrací
      throw e;
    }
    cards.push(...page.data);
    url = page.has_more && page.next_page ? page.next_page : null;
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

// ---------- Riftbound (Riftcodex) ----------

interface RiftSet { set_id: string; name: string; published_on?: string }
interface RiftCard {
  id: string;
  name: string;
  riftbound_id: string;
  collector_number: number;
  classification?: { rarity?: string };
  media?: { image_url?: string };
}

async function discoverRiftbound(): Promise<DiscoveredSet[]> {
  const { items } = await getJson<{ items: RiftSet[] }>('https://api.riftcodex.com/sets?size=100');
  return items.map((s) => ({ id: s.set_id, name: s.name, released_on: s.published_on?.slice(0, 10) }));
}

async function fetchRiftboundSet(id: string): Promise<ImportedSet> {
  const sets = await discoverRiftbound();
  const set = sets.find((s) => s.id === id);
  const cards: RiftCard[] = [];
  for (let page = 1; ; page++) {
    const res = await getJson<{ items: RiftCard[]; pages: number }>(
      `https://api.riftcodex.com/cards?set_id=${encodeURIComponent(id)}&size=100&page=${page}`,
    );
    cards.push(...res.items);
    if (page >= res.pages) break;
  }
  const code = id.toUpperCase();
  return {
    code,
    name: set?.name ?? code,
    released_on: set?.released_on ?? null,
    cards: cards.map((c) => {
      // riftbound_id má tvar „unl-229*-219“: sada, číslo karty (s označením varianty) a počet karet v sadě.
      const parts = c.riftbound_id.split('-');
      const number = parts.length >= 3 ? `${parts[1]}/${parts[2]}` : String(c.collector_number);
      return {
        slug: slugify(c.name, code, number),
        name: c.name,
        number,
        rarity: c.classification?.rarity ?? null,
        // Obrázky Riotu jsou PNG kolem 1,4 MB, CDN je umí převést na WebP (~140 kB).
        image_url: c.media?.image_url ? `${c.media.image_url}${c.media.image_url.includes('?') ? '&' : '?'}fm=webp` : null,
        external_id: `riftcodex:${c.id}`,
      };
    }),
  };
}

// ---------- Lorcana (Lorcast) ----------

interface LorcastSet { code: string; name: string; released_at?: string }
interface LorcastCard {
  id: string;
  name: string;
  version?: string | null;
  collector_number: string;
  rarity?: string;
  image_uris?: { digital?: { large?: string; normal?: string } };
}

// Lorcast žádá 50–100 ms mezi dotazy.
let lastLorcast = 0;
async function lorcast<T>(url: string): Promise<T> {
  const wait = lastLorcast + 100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastLorcast = Date.now();
  return getJson<T>(url);
}

const LORCANA_RARITY: Record<string, string> = { Super_rare: 'Super Rare' };

async function discoverLorcana(): Promise<DiscoveredSet[]> {
  const { results } = await lorcast<{ results: LorcastSet[] }>('https://api.lorcast.com/v0/sets');
  return results.map((s) => ({ id: s.code, name: s.name, released_on: s.released_at }));
}

async function fetchLorcanaSet(code: string): Promise<ImportedSet> {
  const set = await lorcast<LorcastSet>(`https://api.lorcast.com/v0/sets/${encodeURIComponent(code)}`);
  const cards = await lorcast<LorcastCard[]>(`https://api.lorcast.com/v0/sets/${encodeURIComponent(code)}/cards`);
  const upper = code.toUpperCase();
  return {
    code: upper,
    name: set.name,
    released_on: set.released_at ?? null,
    cards: cards.map((c) => {
      const name = c.version ? `${c.name} - ${c.version}` : c.name;
      return {
        slug: slugify(name, upper, c.collector_number),
        name,
        number: c.collector_number,
        rarity: c.rarity ? LORCANA_RARITY[c.rarity] ?? c.rarity.replace(/_/g, ' ') : null,
        image_url: c.image_uris?.digital?.large ?? c.image_uris?.digital?.normal ?? null,
        external_id: `lorcast:${c.id}`,
      };
    }),
  };
}

// ---------- One Piece (OPTCG API) ----------
// Sady: boostery (OP-01, EB-01, PRB-01…), startovací balíčky (ST-01…) a dvě sběrné sady „promo“ a „don“.

interface OptcgCard {
  card_name: string;
  card_set_id?: string;
  card_image_id: string;
  card_image?: string;
  rarity?: string;
  optcg_don_name?: string;
}

const ONEPIECE_RARITY: Record<string, string> = {
  C: 'Common', UC: 'Uncommon', R: 'Rare', SR: 'Super Rare', SEC: 'Secret Rare', L: 'Leader',
  P: 'Promo', PR: 'Promo', TR: 'Treasure Rare', SP: 'Special', 'DON!!': 'DON!!',
};
const ONEPIECE_EXTRA: DiscoveredSet[] = [
  { id: 'promo', name: 'Promo karty' },
  { id: 'don', name: 'DON!! karty' },
];

async function discoverOnePiece(): Promise<DiscoveredSet[]> {
  const sets = await getJson<Array<{ set_id: string; set_name: string }>>('https://optcgapi.com/api/allSets/');
  const decks = await getJson<Array<{ structure_deck_id: string; structure_deck_name: string }>>('https://optcgapi.com/api/allDecks/');
  return [
    ...sets.map((s) => ({ id: s.set_id, name: s.set_name })),
    ...decks.map((d) => ({ id: d.structure_deck_id, name: d.structure_deck_name })),
    ...ONEPIECE_EXTRA,
  ];
}

async function fetchOnePieceSet(id: string): Promise<ImportedSet> {
  let name: string;
  let cards: OptcgCard[];
  if (id === 'promo' || id === 'don') {
    name = ONEPIECE_EXTRA.find((s) => s.id === id)!.name;
    cards = await getJson<OptcgCard[]>(`https://optcgapi.com/api/${id === 'promo' ? 'allPromos' : 'allDonCards'}/`);
  } else {
    const deck = id.startsWith('ST-');
    cards = await getJson<OptcgCard[]>(`https://optcgapi.com/api/${deck ? 'decks' : 'sets'}/${encodeURIComponent(id)}/`);
    const all = (await discoverOnePiece()).find((s) => s.id === id);
    name = all?.name ?? id;
  }
  const code = id.toUpperCase();
  const seen = new Map<string, number>();
  return {
    code,
    name,
    released_on: null,
    cards: cards.map((c) => {
      const cardName = c.optcg_don_name ?? c.card_name;
      // Paralelní a alternativní ilustrace mají v id obrázku koncovku (_p1, _r1), číslo karty ji zachová.
      const number = (c.card_image_id.includes('_') && c.card_set_id
        ? `${c.card_set_id} ${c.card_image_id.split('_').slice(1).join(' ').toUpperCase()}`
        : c.card_set_id ?? c.card_image_id
      ).toUpperCase();
      let slug = slugify(cardName, code, number);
      const n = (seen.get(slug) ?? 0) + 1;
      seen.set(slug, n);
      if (n > 1) slug = `${slug}-${n}`;
      return {
        slug,
        name: cardName,
        number,
        rarity: c.rarity ? ONEPIECE_RARITY[c.rarity] ?? c.rarity : null,
        image_url: c.card_image ?? null,
        external_id: `optcg:${code}:${c.card_image_id}${n > 1 ? `:${n}` : ''}`,
      };
    }),
  };
}

// ---------- Hry ----------

interface DiscoveredSet { id: string; name: string; released_on?: string }

const SOURCES: Record<string, { discover: () => Promise<DiscoveredSet[]>; fetchSet: (id: string) => Promise<ImportedSet> }> = {
  pokemon: { discover: discoverPokemon, fetchSet: fetchPokemonSet },
  magic: { discover: discoverMagic, fetchSet: fetchMagicSet },
  riftbound: { discover: discoverRiftbound, fetchSet: fetchRiftboundSet },
  lorcana: { discover: discoverLorcana, fetchSet: fetchLorcanaSet },
  onepiece: { discover: discoverOnePiece, fetchSet: fetchOnePieceSet },
};

// ---------- Zápis do databáze ----------

async function save(game: string, set: ImportedSet, sourceId: string): Promise<number> {
  // Zkratka sady může být u dvou různých sad stejná (hlavně u starých Pokémonů), pak použijeme id ze zdroje.
  const { data: clash } = await supabase
    .from('card_sets')
    .select('name')
    .match({ game_id: game, code: set.code })
    .maybeSingle();
  if (clash && clash.name !== set.name) {
    const code = sourceId.toUpperCase();
    set = { ...set, code, cards: set.cards.map((c) => ({ ...c, slug: slugify(c.name, code, c.number) })) };
  }

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
    const source = SOURCES[game];
    if (!source) throw new Error(`Neznámá hra ${game}`);
    const set = await source.fetchSet(id);
    const count = await save(game, set, id);
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
      // Každá hra zvlášť, výpadek jednoho zdroje nezastaví ostatní.
      const games: string[] = Array.isArray(body.games) ? body.games : Object.keys(SOURCES);
      const result: Record<string, number | string> = {};
      for (const game of games.filter((g) => g in SOURCES)) {
        try {
          const sets = await SOURCES[game].discover();
          const rows = sets.map((s) => ({ game_id: game, source_set_id: s.id, name: s.name, released_on: s.released_on ?? null }));
          const { error } = await supabase.from('catalog_sources').upsert(rows, { onConflict: 'game_id,source_set_id', ignoreDuplicates: true });
          if (error) throw error;
          result[game] = rows.length;
        } catch (e) {
          result[game] = describe(e);
        }
      }
      return json({ discovered: result });
    }

    if (body.mode === 'set') return json({ imported: await importSet(body.game, body.id) });

    // Režim next: nejdřív sady, které ještě nebyly, pak ty starší než 7 dní a hodinu staré chyby.
    // Víc sad za sebou, dokud je čas.
    const started = Date.now();
    const done: Array<{ set: string; imported?: number; error?: string }> = [];
    while (Date.now() - started < NEXT_BUDGET_MS) {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
      const { data: next } = await supabase
        .from('catalog_sources')
        .select('game_id, source_set_id')
        .or(`imported_at.is.null,imported_at.lt.${weekAgo},and(last_error.not.is.null,imported_at.lt.${hourAgo})`)
        .order('imported_at', { ascending: true, nullsFirst: true })
        .order('released_on', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (!next) break;
      // Sadu si zabereme předem: kdyby import nedoběhl (limit času funkce), plánovač na ní neuvízne
      // a chyba zůstane vidět v last_error.
      await supabase
        .from('catalog_sources')
        .update({ imported_at: new Date().toISOString(), last_error: 'Import nedoběhl do konce' })
        .match({ game_id: next.game_id, source_set_id: next.source_set_id });
      try {
        done.push({ set: next.source_set_id, imported: await importSet(next.game_id, next.source_set_id) });
      } catch (e) {
        done.push({ set: next.source_set_id, error: describe(e) });
      }
    }
    return json(done.length ? { done } : { idle: true });
  } catch (e) {
    return json({ error: describe(e) }, 500);
  }
});
