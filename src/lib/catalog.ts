// Přístup ke katalogu karet. S nastaveným Supabase čte databázi, jinak ukázková data.
// Filtrování zatím běží v aplikaci; při tisících karet se přesune do SQL.
import { cache } from 'react';
import { CARDS, LISTINGS, SELLERS } from './mock-data';
import { isSupabaseConfigured } from './supabase/config';
import { createClient } from './supabase/server';
import type { Card, CardSummary, Condition, Language, Listing, Seller, SellerKind } from './types';
import type { GameId } from './games';

interface CatalogData {
  cards: Card[];
  listings: Listing[];
  sellers: Seller[];
}

const loadData = cache(async (): Promise<CatalogData> => {
  if (!isSupabaseConfigured()) return { cards: CARDS, listings: LISTINGS, sellers: SELLERS };
  const supabase = await createClient();
  const [cards, listings, sellers, history, reviews] = await Promise.all([
    supabase.from('cards').select('id, slug, name, number, rarity, image_url, card_sets(game_id, code, name)'),
    supabase.from('listings').select('id, card_id, seller_id, price_czk, condition, language, quantity, graded, note').gt('quantity', 0),
    supabase.from('profiles').select('id, display_name, kind, country'),
    supabase.from('price_history').select('card_id, day, avg_price_czk').gte('day', daysAgo(30)).order('day'),
    supabase.from('reviews').select('seller_id, rating'),
  ]);
  const failed = [cards, listings, sellers, history, reviews].find((r) => r.error);
  if (failed?.error) throw new Error(`Katalog se nepodařilo načíst: ${failed.error.message}`);

  const historyByCard = new Map<string, number[]>();
  for (const h of history.data ?? []) historyByCard.set(h.card_id, [...(historyByCard.get(h.card_id) ?? []), h.avg_price_czk]);
  const ratings = new Map<string, number[]>();
  for (const r of reviews.data ?? []) ratings.set(r.seller_id, [...(ratings.get(r.seller_id) ?? []), r.rating]);

  return {
    cards: (cards.data ?? []).map((c) => {
      const set = Array.isArray(c.card_sets) ? c.card_sets[0] : c.card_sets;
      return {
        id: c.id,
        slug: c.slug,
        game: set?.game_id as GameId,
        name: c.name,
        setName: set?.name ?? '',
        setCode: set?.code ?? '',
        number: c.number,
        rarity: c.rarity ?? '',
        image: c.image_url ?? undefined,
        priceHistory: historyByCard.get(c.id) ?? [],
      };
    }),
    listings: (listings.data ?? []).map((l) => ({
      id: l.id,
      cardId: l.card_id,
      sellerId: l.seller_id,
      price: l.price_czk,
      condition: l.condition as Condition,
      language: l.language as Language,
      quantity: l.quantity,
      graded: l.graded ?? undefined,
      note: l.note ?? undefined,
    })),
    sellers: (sellers.data ?? []).map((s) => {
      const r = ratings.get(s.id) ?? [];
      return {
        id: s.id,
        name: s.display_name,
        kind: s.kind as SellerKind,
        country: s.country as Seller['country'],
        // Kladné = hodnocení 4 a 5 hvězdiček.
        rating: r.length ? (r.filter((x) => x >= 4).length / r.length) * 100 : null,
        sales: r.length,
      };
    }),
  };
});

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

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

function matchesListing(listing: Listing, query: CatalogQuery, sellers: Seller[]): boolean {
  if (query.condition && listing.condition !== query.condition) return false;
  if (query.language && listing.language !== query.language) return false;
  if (query.sellerKind && sellers.find((s) => s.id === listing.sellerId)?.kind !== query.sellerKind) return false;
  return true;
}

function summarize(card: Card, data: CatalogData, query: CatalogQuery = {}): CardSummary {
  const offers = data.listings.filter((l) => l.cardId === card.id && matchesListing(l, query, data.sellers));
  return {
    ...card,
    minPrice: offers.length ? Math.min(...offers.map((o) => o.price)) : null,
    offers: offers.length,
    trend: trendOf(card.priceHistory),
  };
}

export async function searchCards(query: CatalogQuery): Promise<CardSummary[]> {
  const data = await loadData();
  const q = query.q ? normalize(query.q.trim()) : '';
  const listingFilter = Boolean(query.condition || query.language || query.sellerKind);
  let result = data.cards.filter((card) => {
    if (query.game && card.game !== query.game) return false;
    if (q && !normalize(`${card.name} ${card.setName} ${card.setCode} ${card.number}`).includes(q)) return false;
    return true;
  })
    .map((card) => summarize(card, data, query))
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

export async function getAllCards(): Promise<Card[]> {
  return (await loadData()).cards;
}

export async function getTrending(limit = 8): Promise<CardSummary[]> {
  return (await searchCards({ sort: 'trend' })).slice(0, limit);
}

export async function getCardBySlug(slug: string): Promise<CardSummary | null> {
  const data = await loadData();
  const card = data.cards.find((c) => c.slug === slug);
  return card ? summarize(card, data) : null;
}

export interface Offer extends Listing {
  seller: Seller;
}

export async function getOffers(cardId: string): Promise<Offer[]> {
  const data = await loadData();
  return data.listings
    .filter((l) => l.cardId === cardId)
    .map((l) => ({ ...l, seller: data.sellers.find((s) => s.id === l.sellerId)! }))
    .sort((a, b) => a.price - b.price);
}

export async function getStats(): Promise<{ cards: number; offers: number; sellers: number }> {
  const data = await loadData();
  return { cards: data.cards.length, offers: data.listings.length, sellers: new Set(data.listings.map((l) => l.sellerId)).size };
}
