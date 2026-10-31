// Import katalogů karet do databáze.
//   Pokémon: TCGdex (https://tcgdex.dev), chybějící obrázky z pokemontcg.io, pkmncards.com a Limitless TCG, Magic: Scryfall (https://scryfall.com/docs/api),
//   Riftbound: oficiální galerie Riotu (https://playriftbound.com/en-us/card-gallery/), promo sady a záloha
//   Riftcodex (https://riftcodex.com/docs), Lorcana: Lorcast (https://lorcast.com/docs/api),
//   One Piece: OPTCG API (https://optcgapi.com/documentation), chybějící obrázky z Limitless TCG.
// Volá ho plánovač v databázi (pg_cron) s hlavičkou x-import-secret (heslo je ve Vaultu jako import_secret).
//   { "mode": "discover" }  doplní seznam sad do catalog_sources
//   { "mode": "next" }      importuje sady, které ještě nebyly nebo jsou starší než 7 dní (kolik stihne za ~40 s);
//                           v noci (0–4 h UTC) navíc hledá nové sady a nové karty u všech her
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
// Noční kontrola nových karet (0–4 h UTC): znovu stáhne sady vydané v posledních dnech a sběrné promo sady,
// do kterých průběžně přibývají karty. Riftbound celý, galerie Riotu se stahuje jen jednou.
const NIGHT_END_HOUR_UTC = 4;
const NIGHT_RECENT_DAYS = 60;
const NIGHT_ROLLING: Record<string, string[]> = {
  pokemon: ['svp', 'mep'],
  onepiece: ['promo', 'don'],
};

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

async function discoverAll(games: string[]): Promise<Record<string, number | string>> {
  // Každá hra zvlášť, výpadek jednoho zdroje nezastaví ostatní. Zdroje bez data vydání (One Piece,
  // Pokémon před prvním importem) dostanou u nové sady dnešek, aby ji noční kontrola brala jako novou.
  const today = new Date().toISOString().slice(0, 10);
  const result: Record<string, number | string> = {};
  for (const game of games.filter((g) => g in SOURCES)) {
    try {
      const sets = await SOURCES[game].discover();
      const rows = sets.map((s) => ({ game_id: game, source_set_id: s.id, name: s.name, released_on: s.released_on ?? today }));
      const { error } = await supabase.from('catalog_sources').upsert(rows, { onConflict: 'game_id,source_set_id', ignoreDuplicates: true });
      if (error) throw error;
      result[game] = rows.length;
    } catch (e) {
      result[game] = describe(e);
    }
  }
  return result;
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

// Sady, které se v pokemontcg.io jmenují jinak než v TCGdex (id TCGdex → id pokemontcg.io).
const PTCG_SET_IDS: Record<string, string> = {
  'tk-ex-m': 'tk2b',
  'tk-ex-p': 'tk2a',
  'tk-ex-latia': 'tk1a',
  'tk-ex-latio': 'tk1b',
  '2011bw': 'mcd11',
  '2012bw': 'mcd12',
  '2014xy': 'mcd14',
  '2015xy': 'mcd15',
  '2016xy': 'mcd16',
  '2017sm': 'mcd17',
  '2018sm': 'mcd18',
  '2019sm': 'mcd19',
  '2021swsh': 'mcd21',
  '2022swsh': 'mcd22',
  'cel25cc': 'cel25c',
  '30th-c': 'me55c',
};
// U těchto sad má pokemontcg.io původní čísla karet (Charizard 4/102), TCGdex nová (CC002), párujeme podle jména.
const PTCG_BY_NAME = new Set(['cel25cc']);

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
    const ptcgId = PTCG_SET_IDS[setId] ?? ptcgSets?.get(nameKey(setName)) ?? setId.replace(/\./g, '');
    for (let page = 1; ; page++) {
      const res = await getJson<{ data: Array<{ number: string; name: string; images?: { large?: string } }>; totalCount: number }>(
        `https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(ptcgId)}&select=number,name,images&pageSize=250&page=${page}`,
      );
      for (const c of res.data) {
        if (c.images?.large) images.set(PTCG_BY_NAME.has(setId) ? nameKey(c.name) : numberKey(c.number), c.images.large);
      }
      if (page * 250 >= res.totalCount) break;
    }
  } catch {
    // Záložní zdroj je jen doplněk; bez něj karta zůstane se zástupnou plochou.
  }
  return images;
}

// Třetí zdroj obrázků: Limitless TCG (https://limitlesstcg.com/cards) má skeny nových promo a energií,
// které TCGdex ani pokemontcg.io zatím nemají. Adresa obrázku se dá složit z kódu sady a čísla karty.
const LIMITLESS_SETS: Record<string, string> = { mep: 'MEP', mee: 'MEE', svp: 'SVP', sve: 'SVE', xyp: 'XYP', smp: 'SMP' };

async function limitlessPokemonImage(setId: string, localId: string): Promise<string | null> {
  const code = LIMITLESS_SETS[setId];
  const digits = localId.match(/^[A-Za-z]*0*(\d+)$/)?.[1];
  if (!code || !digits) return null;
  const url = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${code}/${code}_${digits.padStart(3, '0')}_R_EN_LG.png`;
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': HEADERS['User-Agent'] } });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

// Čtvrtý zdroj: pkmncards.com má skeny Trainer Kitů a McDonald's 2023, které jinde nejsou.
// Jedna stránka sady obsahuje všechny karty, číslo je v názvu souboru (en_US-TK6A-001-spoink.jpg).
const PKMNCARDS_SETS: Record<string, string> = {
  'tk-sm-r': 'sun-moon-trainer-kit-alolan-raichu',
  'tk-sm-l': 'sun-moon-trainer-kit-lycanroc',
  'tk-dp-l': 'diamond-pearl-trainer-kit-lucario',
  'tk-dp-m': 'diamond-pearl-trainer-kit-manaphy',
  'tk-hs-g': 'hs-trainer-kit-gyarados',
  'tk-hs-r': 'hs-trainer-kit-raichu',
  'tk-bw-e': 'black-white-trainer-kit-excadrill',
  'tk-bw-z': 'black-white-trainer-kit-zoroark',
  'tk-xy-n': 'xy-trainer-kit-noivern',
  'tk-xy-sy': 'xy-trainer-kit-sylveon',
  'tk-xy-b': 'xy-trainer-kit-bisharp',
  'tk-xy-w': 'xy-trainer-kit-wigglytuff',
  'tk-xy-latia': 'xy-trainer-kit-latias',
  'tk-xy-latio': 'xy-trainer-kit-latios',
  'tk-xy-p': 'xy-trainer-kit-pikachu-libre',
  'tk-xy-su': 'xy-trainer-kit-suicune',
  '2023sv': 'mcdonalds-match-battle-2023',
};

async function pkmncardsImages(setId: string): Promise<Map<string, { url: string; name: string | null }>> {
  const images = new Map<string, { url: string; name: string | null }>();
  const slug = PKMNCARDS_SETS[setId];
  if (!slug) return images;
  try {
    const res = await fetch(`https://pkmncards.com/set/${slug}/?display=images&sort=number&ord=auto`, {
      headers: { 'User-Agent': HEADERS['User-Agent'], Accept: 'text/html' },
    });
    if (!res.ok) return images;
    const html = await res.text();
    // en_US-TK6A-001-spoink.jpg (číslo a jméno karty) nebo m23_en_001_std.jpg (jen číslo).
    const re = /src="(https:\/\/pkmncards\.com\/wp-content\/uploads\/(?:en_US-[A-Za-z0-9]+-0*(\d+)-([a-z0-9_]+)|[a-z0-9]+_en_0*(\d+)_std)\.jpg)"/g;
    for (const m of html.matchAll(re)) {
      const number = m[2] ?? m[4];
      if (!images.has(number)) images.set(number, { url: m[1], name: m[3] ?? null });
    }
  } catch {
    // Záložní zdroj je jen doplněk.
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
  const missing = set.cards.filter((c) => !c.image && !fallback.has(numberKey(c.localId)));
  const pkmncards = missing.length ? await pkmncardsImages(set.id) : new Map<string, { url: string; name: string | null }>();
  for (const c of missing) {
    // U starších kitů pkmncards ukazuje jen část karet a občas z druhé poloviny balíčku,
    // proto obrázek bereme, jen když sedí i jméno karty.
    const fromPkmncards = pkmncards.get(numberKey(c.localId));
    if (fromPkmncards && (!fromPkmncards.name || nameKey(c.name).startsWith(nameKey(fromPkmncards.name)))) {
      fallback.set(numberKey(c.localId), fromPkmncards.url);
      continue;
    }
    const url = await limitlessPokemonImage(set.id, c.localId);
    if (url) fallback.set(numberKey(c.localId), url);
  }
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
        image_url: c.image
          ? `${c.image}/high.webp`
          : fallback.get(numberKey(c.localId)) ?? (PTCG_BY_NAME.has(set.id) ? fallback.get(nameKey(c.name)) : undefined) ?? null,
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

// ---------- Riftbound (oficiální galerie Riotu, záloha Riftcodex) ----------
//
// Hlavní zdroj je oficiální galerie karet https://playriftbound.com/en-us/card-gallery/.
// Riot nemá veřejné API, všechny karty jsou ale jako JSON přímo ve stránce (__NEXT_DATA__).
// Promo sady (JDG, OPP, PR) v galerii nejsou, ty dál bereme z Riftcodexu. Riftcodex je zároveň
// záloha, kdyby galerie nešla stáhnout nebo Riot změnil stránku.

const RIOT_GALLERY_URL = 'https://playriftbound.com/en-us/card-gallery/';

interface RiotCard {
  id: string; // „rad-065-167“
  name: string;
  subtitle?: string | null;
  publicCode: string; // „RAD-065/167“, „OGN-119a/298“, „UNL-230*/219“, „VEN-R01“, „UNL-T01“
  set: { value: { id: string; label: string } };
  cardType?: { type?: Array<{ id: string }>; superType?: Array<{ id: string }> };
  rarity?: { value?: { label?: string } };
  tags?: { tags?: string[] };
  cardImage?: { url?: string };
}

let riotGalleryCache: { at: number; cards: RiotCard[] } | null = null;

// Najde v datech stránky pole karet (objekty s publicCode), ať je zanořené kdekoli.
function findRiotCards(node: unknown, depth = 0): RiotCard[] | null {
  if (depth > 12 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    const first = node[0] as Record<string, unknown> | undefined;
    if (first && typeof first === 'object' && 'publicCode' in first && 'set' in first) return node as RiotCard[];
    for (const item of node) {
      const found = findRiotCards(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const value of Object.values(node)) {
    const found = findRiotCards(value, depth + 1);
    if (found) return found;
  }
  return null;
}

async function riotGallery(): Promise<RiotCard[]> {
  // Jedno stažení (~4 MB) stačí pro všechny sady v jednom běhu funkce.
  if (riotGalleryCache && Date.now() - riotGalleryCache.at < 10 * 60_000) return riotGalleryCache.cards;
  let html = '';
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RIOT_GALLERY_URL, { headers: { 'User-Agent': HEADERS['User-Agent'], Accept: 'text/html' } });
    if (res.ok) {
      html = await res.text();
      break;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${res.status} ${RIOT_GALLERY_URL}`);
  }
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Galerie Riotu: ve stránce chybí __NEXT_DATA__');
  const cards = findRiotCards(JSON.parse(match[1]));
  // Pojistka proti nečekané změně stránky: radši spadnout na zálohu než naimportovat polovinu.
  if (!cards || cards.length < 500) throw new Error(`Galerie Riotu: našlo se jen ${cards?.length ?? 0} karet`);
  riotGalleryCache = { at: Date.now(), cards };
  return cards;
}

// Galerie neuvádí datum vydání. Novou sadu najde noční kontrola v den vydání, takže jako datum
// vezmeme den, kdy ji poprvé uvidíme (u sad, které už známe, zůstane datum z Riftcodexu).
function riotSets(cards: RiotCard[]): DiscoveredSet[] {
  const today = new Date().toISOString().slice(0, 10);
  const sets = new Map<string, string>();
  for (const c of cards) sets.set(c.set.value.id.toUpperCase(), c.set.value.label);
  return [...sets].map(([id, name]) => ({ id, name, released_on: today }));
}

// Číslo karty bez kódu sady: „RAD-065/167“ → „065/167“, „VEN-R01“ → „R01“.
function riotNumber(c: RiotCard): string {
  const dash = c.publicCode.indexOf('-');
  return dash >= 0 ? c.publicCode.slice(dash + 1) : c.publicCode;
}

// Jméno ve stejném tvaru, jaký už v katalogu máme z Riftcodexu: „Seraphine - Inspiring“,
// u legend „Ahri - Nine-Tailed Fox“ a u variant přípona „(Alternate Art)“, „(Signature)“, „(Overnumbered)“.
function riotName(c: RiotCard, number: string): string {
  let name = c.name;
  const isLegend = c.cardType?.type?.some((t) => t.id === 'legend');
  const champion = c.tags?.tags?.at(-1);
  if (c.subtitle) name = `${c.name} - ${c.subtitle}`;
  else if (isLegend && champion && champion !== c.name) name = `${champion} - ${c.name}`;
  const m = number.match(/^(\d+)([a-z*]*)\/(\d+)$/);
  if (number.includes('*')) name += ' (Signature)';
  else if (/^R\d+a$/.test(number) || (m && m[2] === 'a')) name += ' (Alternate Art)';
  else if (m && Number(m[1]) > Number(m[3])) name += ' (Overnumbered)';
  return name;
}

// Obrázky Riotu mají v adrese otisk souboru, podle něj poznáme stejnou kartu i při jiném čísle.
function imageHash(url: string | null | undefined): string | null {
  return url?.match(/\/([0-9a-f]{40})-/)?.[1] ?? null;
}

async function fetchRiotSet(code: string, cards: RiotCard[]): Promise<ImportedSet> {
  const { data: source } = await supabase
    .from('catalog_sources')
    .select('name, released_on')
    .match({ game_id: 'riftbound', source_set_id: code })
    .maybeSingle();

  // Karty, které už v katalogu jsou (z Riftcodexu). Necháme jim slug i jméno, aby nabídky,
  // kolekce a alba dál ukazovaly na stejný řádek; obnoví se jen číslo, vzácnost a obrázek.
  const { data: existing, error } = await supabase
    .from('cards')
    .select('slug, name, number, image_url, card_sets!inner(game_id, code)')
    .eq('card_sets.game_id', 'riftbound')
    .eq('card_sets.code', code);
  if (error) throw error;
  const byHash = new Map<string, typeof existing>();
  const byNumber = new Map<string, typeof existing>();
  for (const row of existing ?? []) {
    const h = imageHash(row.image_url);
    if (h) byHash.set(h, [...(byHash.get(h) ?? []), row]);
    const n = row.number.toLowerCase();
    byNumber.set(n, [...(byNumber.get(n) ?? []), row]);
  }
  const used = new Set<string>();
  const free = (rows: typeof existing | undefined) => (rows ?? []).filter((r) => !used.has(r.slug));

  const out: ImportedCard[] = [];
  for (const c of cards) {
    const number = riotNumber(c);
    const image = c.cardImage?.url ?? null;
    const h = imageHash(image);
    // 1) stejný obrázek, 2) stejné číslo, 3) Riftcodex psal runy a žetony jen číslem („R01“ → „1“).
    const alt = number.match(/^[A-Z]+0*(\d+)$/)?.[1];
    let matches = free(h ? byHash.get(h) : undefined);
    if (!matches.length) matches = free(byNumber.get(number.toLowerCase()));
    if (!matches.length && alt) matches = free(byNumber.get(alt));
    const base = {
      number,
      rarity: c.rarity?.value?.label ?? null,
      // Obrázky Riotu jsou PNG kolem 1,4 MB, CDN je umí převést na WebP (~140 kB).
      image_url: image ? `${image}${image.includes('?') ? '&' : '?'}fm=webp` : null,
      external_id: `riot:${c.id}`,
    };
    if (matches.length) {
      // Riftcodex má u některých karet dvojí záznam, obnovíme oba.
      for (const row of matches) {
        used.add(row.slug);
        out.push({ ...base, slug: row.slug, name: row.name });
      }
    } else {
      const name = riotName(c, number);
      out.push({ ...base, slug: slugify(name, code, number), name });
    }
  }

  return {
    code,
    name: source?.name ?? cards[0]?.set.value.label ?? code,
    released_on: source?.released_on ?? null,
    cards: out,
  };
}

async function discoverRiftbound(): Promise<DiscoveredSet[]> {
  const found = new Map<string, DiscoveredSet>();
  const errors: string[] = [];
  try {
    for (const s of await discoverRiftcodex()) found.set(s.id.toUpperCase(), { ...s, id: s.id.toUpperCase() });
  } catch (e) {
    errors.push(`Riftcodex: ${describe(e)}`);
  }
  try {
    for (const s of riotSets(await riotGallery())) if (!found.has(s.id)) found.set(s.id, s);
  } catch (e) {
    errors.push(describe(e));
  }
  if (!found.size) throw new Error(errors.join('; '));
  return [...found.values()];
}

async function fetchRiftboundSet(id: string): Promise<ImportedSet> {
  const code = id.toUpperCase();
  let riotError: unknown = null;
  try {
    const gallery = await riotGallery();
    // Nové sady z galerie zapíšeme hned, plánovač je pak naimportuje bez čekání na pondělní discover.
    const rows = riotSets(gallery).map((s) => ({ game_id: 'riftbound', source_set_id: s.id, name: s.name, released_on: s.released_on }));
    await supabase.from('catalog_sources').upsert(rows, { onConflict: 'game_id,source_set_id', ignoreDuplicates: true });
    const cards = gallery.filter((c) => c.set.value.id.toUpperCase() === code);
    if (cards.length) return await fetchRiotSet(code, cards);
  } catch (e) {
    riotError = e;
  }
  try {
    return await fetchRiftcodexSet(id);
  } catch (e) {
    if (riotError) throw new Error(`${describe(riotError)}; Riftcodex: ${describe(e)}`);
    throw e;
  }
}

interface RiftSet { set_id: string; name: string; published_on?: string }
interface RiftCard {
  id: string;
  name: string;
  riftbound_id: string;
  collector_number: number;
  classification?: { rarity?: string };
  media?: { image_url?: string };
}

async function discoverRiftcodex(): Promise<DiscoveredSet[]> {
  const { items } = await getJson<{ items: RiftSet[] }>('https://api.riftcodex.com/sets?size=100');
  return items.map((s) => ({ id: s.set_id, name: s.name, released_on: s.published_on?.slice(0, 10) }));
}

async function fetchRiftcodexSet(id: string): Promise<ImportedSet> {
  const sets = await discoverRiftcodex();
  const set = sets.find((s) => s.id.toUpperCase() === id.toUpperCase());
  if (!set) throw new NotFound(`Riftcodex nemá sadu ${id}`);
  const cards: RiftCard[] = [];
  for (let page = 1; ; page++) {
    const res = await getJson<{ items: RiftCard[]; pages: number }>(
      `https://api.riftcodex.com/cards?set_id=${encodeURIComponent(set.id)}&size=100&page=${page}`,
    );
    cards.push(...res.items);
    if (page >= res.pages) break;
  }
  const code = id.toUpperCase();
  return {
    code,
    name: set.name,
    released_on: set.released_on ?? null,
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

// Záložní obrázky z Limitless TCG (https://onepiece.limitlesstcg.com) pro karty, ke kterým optcgapi obrázek nemá.
// Bereme jen přesnou shodu čísla karty bez varianty (P-051, ST14-004). Promo varianty běžných karet
// (OP01-001 v sadě promo, _pr1…) mají vlastní art, obrázek běžné verze by ukazoval jinou kartu.
async function limitlessOnePieceImage(cardId: string, setCode: string): Promise<string | null> {
  if (cardId.includes('_')) return null;
  if (!cardId.startsWith('P-') && (setCode === 'PROMO' || setCode === 'DON')) return null;
  const prefix = cardId.split('-')[0];
  const url = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/${prefix}/${cardId}_EN.webp`;
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': HEADERS['User-Agent'] } });
    return res.ok ? url : null;
  } catch {
    return null;
  }
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
  const fallback = new Map<string, string>();
  for (const c of cards) {
    if (c.card_image || fallback.has(c.card_image_id)) continue;
    const url = await limitlessOnePieceImage(c.card_image_id, code);
    if (url) fallback.set(c.card_image_id, url);
  }
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
        image_url: c.card_image ?? fallback.get(c.card_image_id) ?? null,
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
    // Datum vydání ze zdroje doplníme, pokud ho seznam sad neměl (Pokémon), noční kontrola podle něj hledá nové sady.
    if (set.released_on) {
      await supabase
        .from('catalog_sources')
        .update({ released_on: set.released_on })
        .match({ game_id: game, source_set_id: id })
        .is('released_on', null);
    }
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
      const games: string[] = Array.isArray(body.games) ? body.games : Object.keys(SOURCES);
      return json({ discovered: await discoverAll(games) });
    }

    if (body.mode === 'set') return json({ imported: await importSet(body.game, body.id) });

    // Režim next: nejdřív sady, které ještě nebyly, pak ty starší než 7 dní a hodinu staré chyby.
    // V noci (0–4 h UTC) navíc noční kontrola nových karet: o půlnoci hledá nové sady u všech her
    // (tři pokusy, kdyby jedno volání vypadlo) a pak znovu stáhne čerstvé a sběrné promo sady.
    // Víc sad za sebou, dokud je čas.
    const started = Date.now();
    const now = new Date();
    const night = now.getUTCHours() < NIGHT_END_HOUR_UTC;
    let discovered: Record<string, number | string> | undefined;
    if (now.getUTCHours() === 0 && now.getUTCMinutes() % 20 === 0) discovered = await discoverAll(Object.keys(SOURCES));
    const done: Array<{ set: string; imported?: number; error?: string }> = [];
    while (Date.now() - started < NEXT_BUDGET_MS) {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
      const recent = new Date(Date.now() - NIGHT_RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
      const rolling = Object.entries(NIGHT_ROLLING).map(([g, ids]) => `and(game_id.eq.${g},source_set_id.in.(${ids.join(',')}))`);
      const nightly = night
        ? `,and(imported_at.lt.${new Date(Date.now() - 12 * 3_600_000).toISOString()},or(game_id.eq.riftbound,released_on.gte.${recent},${rolling.join(',')}))`
        : '';
      const { data: next } = await supabase
        .from('catalog_sources')
        .select('game_id, source_set_id')
        .or(`imported_at.is.null,imported_at.lt.${weekAgo},and(last_error.not.is.null,imported_at.lt.${hourAgo})${nightly}`)
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
    return json(done.length || discovered ? { discovered, done } : { idle: true });
  } catch (e) {
    return json({ error: describe(e) }, 500);
  }
});
