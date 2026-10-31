import type { SupabaseClient } from '@supabase/supabase-js';
import { compareCardNumbers } from './album/designs';
import type { GameId } from './games';
import { createClient } from './supabase/server';

// Moje kolekce: karty, které uživatel má (collection_cards), a jeho alba (collection_albums).
// Album sady ukazuje všechny karty sady podle čísla, prázdná místa jsou karty, které chybí.
// Vlastní album má vlastní seznam karet (collection_album_cards) v pořadí podle position.

export interface AlbumCard {
  id: string;
  slug: string;
  name: string;
  number: string;
  rarity: string | null;
  image: string | null;
  setName: string;
  game: GameId;
  /** Kolik kusů uživatel má (0 = chybí) */
  owned: number;
  minPrice: number | null;
  offers: number;
}

export interface AlbumSummary {
  id: string;
  name: string;
  design: number;
  sleeve: number;
  kind: 'set' | 'custom';
  setId: string | null;
  setName: string | null;
  setCode: string | null;
  setYear: number | null;
  game: GameId | null;
  have: number;
  /** Míst v albu (u vlastního alba = počet karet) */
  total: number;
  value: number;
  updatedAt: string;
}

export interface AlbumDetail extends AlbumSummary {
  cards: AlbumCard[];
}

interface AlbumRow {
  id: string;
  name: string;
  design: number;
  sleeve: number;
  kind: 'set' | 'custom';
  set_id: string | null;
  updated_at: string;
  card_sets: { name: string; code: string; game_id: GameId; released_on: string | null } | null;
}

interface CardRow {
  id: string;
  slug: string;
  name: string;
  number: string;
  rarity: string | null;
  image_url: string | null;
  game_id: GameId | null;
  card_sets: { name: string; game_id: GameId } | null;
}

const CARD_COLS = 'id, slug, name, number, rarity, image_url, game_id, card_sets(name, game_id)';
const ALBUM_COLS = 'id, name, design, sleeve, kind, set_id, updated_at, card_sets(name, code, game_id, released_on)';

function chunks<T>(a: T[], n = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

/** Nejnižší cena a počet nabídek pro karty (jen nabídky se skladem). */
export async function offerStats(supabase: SupabaseClient, ids: string[]): Promise<Map<string, { min: number; n: number }>> {
  const m = new Map<string, { min: number; n: number }>();
  // části se ptají naráz, ne jedna po druhé (každý dotaz je cesta do databáze)
  const parts = await Promise.all(chunks([...new Set(ids)]).map((part) =>
    supabase.from('listings').select('card_id, price_czk').in('card_id', part).gt('quantity', 0)));
  for (const { data } of parts) {
    for (const r of (data ?? []) as Array<{ card_id: string; price_czk: number }>) {
      const s = m.get(r.card_id);
      if (!s) m.set(r.card_id, { min: r.price_czk, n: 1 });
      else { s.min = Math.min(s.min, r.price_czk); s.n++; }
    }
  }
  return m;
}

async function ownedMap(supabase: SupabaseClient, ids?: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (ids) {
    const parts = await Promise.all(chunks(ids).map((part) => supabase.from('collection_cards').select('card_id, quantity').in('card_id', part)));
    for (const { data } of parts) {
      for (const r of (data ?? []) as Array<{ card_id: string; quantity: number }>) m.set(r.card_id, r.quantity);
    }
  } else {
    const { data } = await supabase.from('collection_cards').select('card_id, quantity').limit(10000);
    for (const r of (data ?? []) as Array<{ card_id: string; quantity: number }>) m.set(r.card_id, r.quantity);
  }
  return m;
}

function toCard(r: CardRow, owned: number, st?: { min: number; n: number }): AlbumCard {
  return {
    id: r.id, slug: r.slug, name: r.name, number: r.number, rarity: r.rarity, image: r.image_url,
    setName: r.card_sets?.name ?? '', game: (r.game_id ?? r.card_sets?.game_id ?? 'pokemon') as GameId,
    owned, minPrice: st?.min ?? null, offers: st?.n ?? 0,
  };
}

function summaryOf(a: AlbumRow): Omit<AlbumSummary, 'have' | 'total' | 'value'> {
  return {
    id: a.id, name: a.name, design: a.design, sleeve: a.sleeve, kind: a.kind, setId: a.set_id,
    setName: a.card_sets?.name ?? null, setCode: a.card_sets?.code ?? null,
    setYear: a.card_sets?.released_on ? Number(a.card_sets.released_on.slice(0, 4)) : null,
    game: a.card_sets?.game_id ?? null, updatedAt: a.updated_at,
  };
}

/** Řádky karet alba v pořadí, ve kterém leží v kapsách (bez cen a vlastnictví). */
async function albumRows(supabase: SupabaseClient, a: AlbumRow): Promise<CardRow[]> {
  let rows: CardRow[] = [];
  if (a.kind === 'set' && a.set_id) {
    const { data } = await supabase.from('cards').select(CARD_COLS).eq('set_id', a.set_id).eq('hidden', false).limit(1000)
      .returns<CardRow[]>();
    rows = (data ?? []).sort((x, y) => compareCardNumbers(x.number, y.number));
  } else {
    const { data } = await supabase.from('collection_album_cards').select(`position, cards(${CARD_COLS})`).eq('album_id', a.id)
      .order('position').returns<Array<{ position: number; cards: CardRow | null }>>();
    rows = (data ?? []).map((r) => r.cards).filter((c): c is CardRow => !!c);
  }
  return rows;
}

/** Karty alba v pořadí, ve kterém leží v kapsách. */
async function albumCards(supabase: SupabaseClient, a: AlbumRow): Promise<AlbumCard[]> {
  const rows = await albumRows(supabase, a);
  const ids = rows.map((r) => r.id);
  const [owned, stats] = await Promise.all([ownedMap(supabase, ids), offerStats(supabase, ids)]);
  return rows.map((r) => toCard(r, owned.get(r.id) ?? 0, stats.get(r.id)));
}

export async function getAlbum(id: string): Promise<AlbumDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('collection_albums').select(ALBUM_COLS).eq('id', id).maybeSingle<AlbumRow>();
  if (!data) return null;
  const cards = await albumCards(supabase, data);
  const have = cards.filter((c) => c.owned > 0).length;
  const value = cards.reduce((s, c) => s + (c.owned && c.minPrice ? c.minPrice * c.owned : 0), 0);
  return { ...summaryOf(data), cards, have, total: cards.length, value };
}

export interface CollectionOverview {
  albums: AlbumSummary[];
  cardCount: number;
  uniqueCount: number;
  addedThisWeek: number;
  value: number;
  /** Chybějící karty z alb sad (nový wishlist), nejdřív ty v nabídce */
  missing: Array<AlbumCard & { albumId: string; albumName: string }>;
  missingTotal: number;
  missingOffered: number;
  /** Ve kterých albech karta je (filtr Všechny karty) */
  cardAlbums: Record<string, string[]>;
}

export async function getCollectionOverview(): Promise<CollectionOverview> {
  const supabase = await createClient();
  const [{ data: albumRows_ }, owned] = await Promise.all([
    supabase.from('collection_albums').select(ALBUM_COLS).order('updated_at', { ascending: false }).returns<AlbumRow[]>(),
    pages(20000, (from, to) => supabase.from('collection_cards').select('card_id, quantity, added_at').order('card_id').range(from, to)
      .returns<Array<{ card_id: string; quantity: number; added_at: string }>>()),
  ]);
  const own = owned ?? [];
  const weekAgo = Date.now() - 7 * 86400_000;
  // karty všech alb naráz a pak jeden společný dotaz na ceny; vlastnictví už známe z `own`
  const ownQty = new Map(own.map((o) => [o.card_id, o.quantity]));
  const rowsOf = await Promise.all((albumRows_ ?? []).map((a) => albumRows(supabase, a)));
  const allStats = await offerStats(supabase, [...own.map((o) => o.card_id), ...rowsOf.flat().map((r) => r.id)]);
  const value = own.reduce((s, o) => s + (allStats.get(o.card_id)?.min ?? 0) * o.quantity, 0);

  const albums: AlbumSummary[] = [];
  const missing: CollectionOverview['missing'] = [];
  let missingTotal = 0;
  let missingOffered = 0;
  const cardAlbums: Record<string, string[]> = {};
  for (const [ai, a] of (albumRows_ ?? []).entries()) {
    for (const r of rowsOf[ai]) (cardAlbums[r.id] ??= []).includes(a.id) || cardAlbums[r.id].push(a.id);
    const cards = rowsOf[ai].map((r) => toCard(r, ownQty.get(r.id) ?? 0, allStats.get(r.id)));
    const have = cards.filter((c) => c.owned > 0).length;
    albums.push({
      ...summaryOf(a), have, total: cards.length,
      value: cards.reduce((s, c) => s + (c.owned && c.minPrice ? c.minPrice * c.owned : 0), 0),
    });
    if (a.kind === 'set') {
      for (const c of cards) {
        if (c.owned) continue;
        missingTotal++;
        if (c.offers) missingOffered++;
        missing.push({ ...c, albumId: a.id, albumName: a.name });
      }
    }
  }
  missing.sort((x, y) => (y.offers ? 1 : 0) - (x.offers ? 1 : 0));
  return {
    albums,
    cardCount: own.reduce((s, o) => s + o.quantity, 0),
    uniqueCount: own.length,
    addedThisWeek: own.filter((o) => Date.parse(o.added_at) > weekAgo).length,
    value,
    missing: missing.slice(0, 5000),
    missingTotal,
    missingOffered,
    cardAlbums,
  };
}

/** Všechny karty ve sbírce (záložka Všechny karty). */
export async function getCollectionCards(limit = 5000): Promise<AlbumCard[]> {
  const supabase = await createClient();
  // databáze vrací nejvýš 1000 řádků naráz, proto po stránkách
  const data = await pages(limit, (from, to) => supabase.from('collection_cards').select(`quantity, added_at, cards(${CARD_COLS})`)
    .order('added_at', { ascending: false }).order('card_id').range(from, to).returns<Array<{ quantity: number; cards: CardRow | null }>>());
  const rows = data.filter((r) => r.cards);
  const stats = await offerStats(supabase, rows.map((r) => r.cards!.id));
  return rows.map((r) => toCard(r.cards!, r.quantity, stats.get(r.cards!.id)));
}

/** Načte řádky po stránkách po 1000 (víc databáze naráz nevrátí). */
async function pages<T>(limit: number, q: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < limit; from += 1000) {
    const { data } = await q(from, Math.min(from + 999, limit - 1));
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Alba, do kterých se karta hodí (detail karty: „Mám ji“). */
export async function albumsForCard(cardId: string): Promise<{
  owned: number;
  albums: Array<{ id: string; name: string; design: number; kind: 'set' | 'custom'; fits: boolean; inAlbum: boolean; position: number | null }>;
}> {
  const supabase = await createClient();
  const { data: card } = await supabase.from('cards').select('id, set_id, number').eq('id', cardId).maybeSingle<{ id: string; set_id: string; number: string }>();
  if (!card) return { owned: 0, albums: [] };
  const [{ data: albums }, { data: own }, { data: inCustom }] = await Promise.all([
    supabase.from('collection_albums').select('id, name, design, kind, set_id').order('updated_at', { ascending: false })
      .returns<Array<{ id: string; name: string; design: number; kind: 'set' | 'custom'; set_id: string | null }>>(),
    supabase.from('collection_cards').select('quantity').eq('card_id', cardId).maybeSingle<{ quantity: number }>(),
    supabase.from('collection_album_cards').select('album_id').eq('card_id', cardId).returns<Array<{ album_id: string }>>(),
  ]);
  const inC = new Set((inCustom ?? []).map((r) => r.album_id));
  // pozice karty v sadě je pro všechna alba té sady stejná: jeden dotaz, ne jeden za každé album
  let setPos: number | null = null;
  if ((albums ?? []).some((a) => a.kind === 'set' && a.set_id === card.set_id)) {
    const { data: nums } = await supabase.from('cards').select('number').eq('set_id', card.set_id).eq('hidden', false).limit(1000)
      .returns<Array<{ number: string }>>();
    const sorted = (nums ?? []).map((n) => n.number).sort(compareCardNumbers);
    setPos = sorted.indexOf(card.number) + 1 || null;
  }
  const out = [];
  for (const a of albums ?? []) {
    const position = a.kind === 'set' && a.set_id === card.set_id ? setPos : null;
    out.push({
      id: a.id, name: a.name, design: a.design, kind: a.kind,
      fits: a.kind === 'custom' || a.set_id === card.set_id,
      inAlbum: a.kind === 'custom' ? inC.has(a.id) : a.set_id === card.set_id && !!own,
      position,
    });
  }
  out.sort((x, y) => Number(y.fits && y.kind === 'set') - Number(x.fits && x.kind === 'set') || Number(y.fits) - Number(x.fits));
  return { owned: own?.quantity ?? 0, albums: out };
}
