// Přístup ke katalogu karet. Zatím čte ukázková data; po připojení Supabase se tady
// vymění zdroj, stránky zůstanou stejné.
import { CARDS, LISTINGS, SELLERS } from './mock-data';
import type { Card, CardSummary, Condition, Language, Listing, Seller, SellerKind } from './types';
import type { GameId } from './games';

export type SortKey = 'relevance' | 'price-asc' | 'price-desc' | 'trend';

export interface CatalogQuery {
  q?: string;
  game?: GameId;
  condition?: Condition;
  language?: Language;
  sellerKind?: SellerKind;
  sort?: SortKey;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function trendOf(history: number[]): number {
  if (history.length < 2) return 0;
  return ((history[history.length - 1] - history[0]) / history[0]) * 100;
}

function matchesListing(listing: Listing, query: CatalogQuery): boolean {
  if (query.condition && listing.condition !== query.condition) return false;
  if (query.language && listing.language !== query.language) return false;
  if (query.sellerKind && SELLERS.find((s) => s.id === listing.sellerId)?.kind !== query.sellerKind) return false;
  return true;
}

function summarize(card: Card, query: CatalogQuery = {}): CardSummary {
  const offers = LISTINGS.filter((l) => l.cardId === card.id && matchesListing(l, query));
  return {
    ...card,
    minPrice: offers.length ? Math.min(...offers.map((o) => o.price)) : null,
    offers: offers.length,
    trend: trendOf(card.priceHistory),
  };
}

export async function searchCards(query: CatalogQuery): Promise<CardSummary[]> {
  const q = query.q ? normalize(query.q.trim()) : '';
  const listingFilter = Boolean(query.condition || query.language || query.sellerKind);
  let result = CARDS.filter((card) => {
    if (query.game && card.game !== query.game) return false;
    if (q && !normalize(`${card.name} ${card.setName} ${card.setCode} ${card.number}`).includes(q)) return false;
    return true;
  })
    .map((card) => summarize(card, query))
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
  return result;
}

export async function getTrending(limit = 8): Promise<CardSummary[]> {
  return (await searchCards({ sort: 'trend' })).slice(0, limit);
}

export async function getCardBySlug(slug: string): Promise<CardSummary | null> {
  const card = CARDS.find((c) => c.slug === slug);
  return card ? summarize(card) : null;
}

export interface Offer extends Listing {
  seller: Seller;
}

export async function getOffers(cardId: string): Promise<Offer[]> {
  return LISTINGS.filter((l) => l.cardId === cardId)
    .map((l) => ({ ...l, seller: SELLERS.find((s) => s.id === l.sellerId)! }))
    .sort((a, b) => a.price - b.price);
}

export async function getStats(): Promise<{ cards: number; offers: number; sellers: number }> {
  return { cards: CARDS.length, offers: LISTINGS.length, sellers: SELLERS.length };
}
