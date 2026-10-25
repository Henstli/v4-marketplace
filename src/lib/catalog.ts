// Přístup ke katalogu karet. S nastaveným Supabase čte databázi (vyhledávání a filtry
// běží v SQL funkci search_cards), jinak ukázková data z mock-data.ts.
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { CARDS, LISTINGS, SELLERS } from './mock-data';
import { isSupabaseConfigured } from './supabase/config';
import { createPublicClient } from './supabase/public';
import type { Card, CardSummary, Condition, Language, Listing, Seller, SellerKind } from './types';
import type { GameId } from './games';

export type SortKey = 'relevance' | 'price-asc' | 'price-desc' | 'trend';

export const PAGE_SIZE = 48;

export interface CatalogQuery {
  q?: string;
  game?: GameId;
  condition?: Condition;
  language?: Language;
  sellerKind?: SellerKind;
  sort?: SortKey;
  /** Jen karty, které někdo prodává */
  onlyOffers?: boolean;
  /** Stránka od 1 */
  page?: number;
  pageSize?: number;
}

export interface CatalogPage {
  cards: CardSummary[];
  total: number;
}

/** Návrh karty v našeptávači vyhledávání */
export interface Suggestion {
  slug: string;
  name: string;
  number: string;
  setName: string;
  game: GameId;
  image?: string;
  minPrice: number | null;
}

export const SUGGEST_LIMIT = 6;

export interface Offer extends Listing {
  seller: Seller;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function trendOf(history: number[]): number {
  if (history.length < 2 || !history[0]) return 0;
  return ((history[history.length - 1] - history[0]) / history[0]) * 100;
}

// ---------- Databáze ----------

interface SearchRow {
  id: string;
  slug: string;
  name: string;
  number: string;
  rarity: string | null;
  image_url: string | null;
  game_id: GameId;
  set_code: string;
  set_name: string;
  history: number[] | null;
  min_price: number | null;
  offers: number;
  trend: number | null;
  total_count: number;
}

function fromRow(r: SearchRow): CardSummary {
  return {
    id: r.id,
    slug: r.slug,
    game: r.game_id,
    name: r.name,
    setName: r.set_name,
    setCode: r.set_code,
    number: r.number,
    rarity: r.rarity ?? '',
    image: r.image_url ?? undefined,
    priceHistory: r.history ?? [],
    minPrice: r.min_price,
    offers: r.offers,
    trend: r.trend != null ? Number(r.trend) : 0,
  };
}

async function dbSearch(query: CatalogQuery): Promise<CatalogPage> {
  const supabase = createPublicClient();
  const size = query.pageSize ?? PAGE_SIZE;
  const { data, error } = await supabase.rpc('search_cards', {
    p_q: query.q ?? null,
    p_game: query.game ?? null,
    p_condition: query.condition ?? null,
    p_language: query.language ?? null,
    p_seller_kind: query.sellerKind ?? null,
    p_sort: query.sort ?? 'relevance',
    p_only_offers: query.onlyOffers ?? false,
    p_limit: size,
    p_offset: ((query.page ?? 1) - 1) * size,
  });
  if (error) throw new Error(`Katalog se nepodařilo načíst: ${error.message}`);
  const rows = (data ?? []) as SearchRow[];
  return { cards: rows.map(fromRow), total: rows[0]?.total_count ?? 0 };
}

interface SuggestRow {
  slug: string;
  name: string;
  number: string;
  image_url: string | null;
  game_id: GameId;
  set_name: string;
  min_price: number | null;
}

async function dbSuggest(q: string, game?: GameId): Promise<Suggestion[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('suggest_cards', { p_q: q, p_game: game ?? null, p_limit: SUGGEST_LIMIT });
  if (error) throw new Error(`Návrhy se nepodařilo načíst: ${error.message}`);
  return ((data ?? []) as SuggestRow[]).map((r) => ({
    slug: r.slug,
    name: r.name,
    number: r.number,
    setName: r.set_name,
    game: r.game_id,
    image: r.image_url ?? undefined,
    minPrice: r.min_price,
  }));
}

async function dbOffers(cardId: string): Promise<Offer[]> {
  const supabase = createPublicClient();
  const { data: listings, error } = await supabase
    .from('listings')
    .select('id, card_id, seller_id, price_czk, condition, language, quantity, graded, note, profiles(display_name, kind, country)')
    .eq('card_id', cardId)
    .gt('quantity', 0)
    .order('price_czk');
  if (error) throw new Error(`Nabídky se nepodařilo načíst: ${error.message}`);
  const sellerIds = [...new Set((listings ?? []).map((l) => l.seller_id))];
  const { data: reviews } = sellerIds.length
    ? await supabase.from('reviews').select('seller_id, rating').in('seller_id', sellerIds)
    : { data: [] };
  const ratings = new Map<string, number[]>();
  for (const r of reviews ?? []) ratings.set(r.seller_id, [...(ratings.get(r.seller_id) ?? []), r.rating]);

  return (listings ?? []).map((l) => {
    const p = (Array.isArray(l.profiles) ? l.profiles[0] : l.profiles) as { display_name: string; kind: string; country: string } | null;
    const r = ratings.get(l.seller_id) ?? [];
    return {
      id: l.id,
      cardId: l.card_id,
      sellerId: l.seller_id,
      price: l.price_czk,
      condition: l.condition as Condition,
      language: l.language as Language,
      quantity: l.quantity,
      graded: l.graded ?? undefined,
      note: l.note ?? undefined,
      seller: {
        id: l.seller_id,
        name: p?.display_name ?? 'Prodejce',
        kind: (p?.kind ?? 'private') as SellerKind,
        country: (p?.country ?? 'CZ') as Seller['country'],
        // Kladné = hodnocení 4 a 5 hvězdiček.
        rating: r.length ? (r.filter((x) => x >= 4).length / r.length) * 100 : null,
        sales: r.length,
      },
    };
  });
}

async function dbCardBySlug(slug: string): Promise<CardSummary | null> {
  const supabase = createPublicClient();
  const { data: c } = await supabase
    .from('cards')
    .select('id, slug, name, number, rarity, image_url, card_sets(game_id, code, name)')
    .eq('slug', slug)
    .maybeSingle();
  if (!c) return null;
  const set = (Array.isArray(c.card_sets) ? c.card_sets[0] : c.card_sets) as { game_id: GameId; code: string; name: string } | null;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: history }, offers] = await Promise.all([
    supabase.from('price_history').select('avg_price_czk').eq('card_id', c.id).gte('day', since).order('day'),
    getOffers(c.id),
  ]);
  const priceHistory = (history ?? []).map((h) => h.avg_price_czk as number);
  return {
    id: c.id,
    slug: c.slug,
    game: set?.game_id ?? 'pokemon',
    name: c.name,
    setName: set?.name ?? '',
    setCode: set?.code ?? '',
    number: c.number,
    rarity: c.rarity ?? '',
    image: c.image_url ?? undefined,
    priceHistory,
    minPrice: offers.length ? Math.min(...offers.map((o) => o.price)) : null,
    offers: offers.length,
    trend: trendOf(priceHistory),
  };
}

// ---------- Ukázková data ----------

function mockMatchesListing(listing: Listing, query: CatalogQuery): boolean {
  if (query.condition && listing.condition !== query.condition) return false;
  if (query.language && listing.language !== query.language) return false;
  if (query.sellerKind && SELLERS.find((s) => s.id === listing.sellerId)?.kind !== query.sellerKind) return false;
  return true;
}

function mockSummarize(card: Card, query: CatalogQuery = {}): CardSummary {
  const offers = LISTINGS.filter((l) => l.cardId === card.id && mockMatchesListing(l, query));
  return {
    ...card,
    minPrice: offers.length ? Math.min(...offers.map((o) => o.price)) : null,
    offers: offers.length,
    trend: trendOf(card.priceHistory),
  };
}

function mockSearch(query: CatalogQuery): CatalogPage {
  const q = query.q ? normalize(query.q.trim()) : '';
  const listingFilter = Boolean(query.condition || query.language || query.sellerKind || query.onlyOffers);
  let result = CARDS.filter((card) => {
    if (query.game && card.game !== query.game) return false;
    if (q && !normalize(`${card.name} ${card.setName} ${card.setCode} ${card.number}`).includes(q)) return false;
    return true;
  })
    .map((card) => mockSummarize(card, query))
    .filter((card) => !listingFilter || card.offers > 0);

  switch (query.sort) {
    case 'price-asc':
      result = result.sort((a, b) => (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity));
      break;
    case 'price-desc':
      result = result.sort((a, b) => (b.minPrice ?? 0) - (a.minPrice ?? 0));
      break;
    case 'trend':
      result = result.sort((a, b) => b.trend - a.trend);
      break;
  }
  const size = query.pageSize ?? PAGE_SIZE;
  const start = ((query.page ?? 1) - 1) * size;
  return { cards: result.slice(start, start + size), total: result.length };
}

// ---------- Veřejné funkce ----------

export async function searchCards(query: CatalogQuery): Promise<CatalogPage> {
  return isSupabaseConfigured() ? dbSearch(query) : mockSearch(query);
}

// Našeptávač: pár nejpodobnějších karet k rozepsanému dotazu (od 2 znaků, toleruje překlepy).
export async function suggestCards(q: string, game?: GameId): Promise<Suggestion[]> {
  if (normalize(q.trim()).length < 2) return [];
  if (isSupabaseConfigured()) return dbSuggest(q, game);
  return mockSearch({ q, game, pageSize: SUGGEST_LIMIT }).cards.map((c) => ({
    slug: c.slug,
    name: c.name,
    number: c.number,
    setName: c.setName,
    game: c.game,
    image: c.image,
    minPrice: c.minPrice,
  }));
}

// Úvodní stránka je pro všechny stejná, stačí ji z databáze načíst jednou za minutu.
const HOME_CACHE = { revalidate: 60 };

const dbTrending = unstable_cache(
  async (limit: number) => (await dbSearch({ sort: 'trend', onlyOffers: true, pageSize: limit })).cards,
  ['home-trending'],
  HOME_CACHE,
);

export async function getTrending(limit = 8): Promise<CardSummary[]> {
  if (isSupabaseConfigured()) return dbTrending(limit);
  return mockSearch({ sort: 'trend', onlyOffers: true, pageSize: limit }).cards;
}

// cache(): metadata i stránka detailu čtou stejnou kartu a nabídky jen jednou za požadavek.
export const getCardBySlug = cache(async (slug: string): Promise<CardSummary | null> => {
  if (isSupabaseConfigured()) return dbCardBySlug(slug);
  const card = CARDS.find((c) => c.slug === slug);
  return card ? mockSummarize(card) : null;
});

export const getOffers = cache(async (cardId: string): Promise<Offer[]> => {
  if (isSupabaseConfigured()) return dbOffers(cardId);
  return LISTINGS.filter((l) => l.cardId === cardId)
    .map((l) => ({ ...l, seller: SELLERS.find((s) => s.id === l.sellerId)! }))
    .sort((a, b) => a.price - b.price);
});

const dbStats = unstable_cache(
  async () => {
    const supabase = createPublicClient();
    // Přesný počet 120 tisíc karet stojí stovky ms, odhad z plánovače stačí.
    const [cards, listings] = await Promise.all([
      supabase.from('cards').select('id', { count: 'estimated', head: true }),
      supabase.from('listings').select('seller_id').gt('quantity', 0),
    ]);
    return {
      cards: cards.count ?? 0,
      offers: listings.data?.length ?? 0,
      sellers: new Set((listings.data ?? []).map((l) => l.seller_id)).size,
    };
  },
  ['home-stats'],
  HOME_CACHE,
);

export async function getStats(): Promise<{ cards: number; offers: number; sellers: number }> {
  if (!isSupabaseConfigured()) {
    return { cards: CARDS.length, offers: LISTINGS.length, sellers: new Set(LISTINGS.map((l) => l.sellerId)).size };
  }
  return dbStats();
}
