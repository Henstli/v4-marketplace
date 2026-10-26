// Načítání vlastních stránek prodejců, tarifů a ověření z databáze (jen na serveru).
import { cache } from 'react';
import { isSupabaseConfigured, SUPABASE_URL } from './supabase/config';
import { createPublicClient } from './supabase/public';
import { getSeller } from './catalog';
import { PLANS, toPlan, type Plan } from './plans';
import { defaultConfig, effectiveConfig, hasVerifiedBadge, sanitizeConfig, shopHref, type ShopPageConfig } from './shop-config';
import { CONDITIONS, type Condition, type Language, type Seller } from './types';
import type { GameId } from './games';

/** Veřejná adresa obrázku z bucketu shop-media */
export function mediaUrl(path: string | null | undefined): string | null {
  return path ? `${SUPABASE_URL}/storage/v1/object/public/shop-media/${path}` : null;
}

/** Zmenšený obrázek přes optimalizaci Next.js, aby se velké nahrané fotky nenačítaly celé (šířka z images.imageSizes/deviceSizes). */
export function mediaImage(path: string | null | undefined, width: 256 | 1080 | 1920): string | null {
  const url = mediaUrl(path);
  return url ? `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=80` : null;
}

interface PageRow {
  user_id: string;
  slug: string | null;
  published: boolean;
  tagline: string | null;
  about: string | null;
  offer_note: string | null;
  logo_path: string | null;
  banner_path: string | null;
  design: unknown;
  blocks: unknown;
  collections: unknown;
  contact: unknown;
  store: unknown;
}

const PAGE_COLUMNS = 'user_id, slug, published, tagline, about, offer_note, logo_path, banner_path, design, blocks, collections, contact, store';

export function configFromRow(row: PageRow, kind: Seller['kind']): ShopPageConfig {
  return sanitizeConfig({
    slug: row.slug, published: row.published, tagline: row.tagline, about: row.about, offerNote: row.offer_note,
    logoPath: row.logo_path, bannerPath: row.banner_path, design: row.design, blocks: row.blocks,
    collections: row.collections, contact: row.contact, store: row.store,
  }, row.user_id, kind);
}

export function configToRow(config: ShopPageConfig) {
  return {
    slug: config.slug || null,
    published: config.published,
    tagline: config.tagline || null,
    about: config.about || null,
    offer_note: config.offerNote || null,
    logo_path: config.logoPath || null,
    banner_path: config.bannerPath || null,
    design: config.design,
    blocks: config.blocks,
    collections: config.collections,
    contact: config.contact,
    store: config.store,
    updated_at: new Date().toISOString(),
  };
}

/** Tarify prodejců (bez řádku = zdarma) */
export async function getSellerPlans(ids: string[]): Promise<Map<string, Plan>> {
  const out = new Map<string, Plan>();
  if (!isSupabaseConfigured() || !ids.length) return out;
  const { data } = await createPublicClient().rpc('seller_plans', { p_ids: ids });
  for (const r of (data ?? []) as { user_id: string; plan: string }[]) out.set(r.user_id, toPlan(r.plan));
  return out;
}

export async function getVerified(ids: string[]): Promise<Set<string>> {
  if (!isSupabaseConfigured() || !ids.length) return new Set();
  const { data } = await createPublicClient().from('seller_verifications').select('user_id').in('user_id', ids);
  return new Set((data ?? []).map((r) => r.user_id as string));
}

/** Logo, vzkaz a barva prodejců pro nabídky u karty */
export async function getSellerBrands(ids: string[]): Promise<Map<string, { logo: string | null; note: string; color: string; slug: string | null; published: boolean }>> {
  const out = new Map();
  if (!isSupabaseConfigured() || !ids.length) return out;
  const { data } = await createPublicClient().from('shop_pages').select('user_id, logo_path, offer_note, design, slug, published').in('user_id', ids);
  for (const r of data ?? []) {
    const design = (r.design ?? {}) as { color?: string };
    out.set(r.user_id, { logo: mediaImage(r.logo_path, 256), note: r.offer_note ?? '', color: design.color ?? 'blue', slug: r.slug, published: r.published });
  }
  return out;
}

export interface Achievement {
  icon: string;
  label: string;
}

export interface ShopProfile {
  seller: Seller;
  /** Odznaky úspěchů, sbírají se samy */
  achievements: Achievement[];
  plan: Plan;
  verified: boolean;
  badge: boolean;
  /** Uložené nastavení (pro editor) */
  saved: ShopPageConfig;
  /** Co se ukáže při současném tarifu */
  config: ShopPageConfig;
  exists: boolean;
}

/** Odznaky úspěchů z hodnocení a doby na V4cards (nedají se koupit ani nastavit). */
export function achievementsFor(seller: Seller, since: string | null): Achievement[] {
  const out: Achievement[] = [];
  const steps = [1000, 500, 100, 50, 10];
  const step = steps.find((n) => seller.sales >= n);
  if (step) out.push({ icon: '🏆', label: `${step.toLocaleString('cs-CZ')}+ hodnocených prodejů` });
  if (seller.rating === 100 && seller.sales >= 10) out.push({ icon: '💯', label: '100 % kladných' });
  else if ((seller.rating ?? 0) >= 98 && seller.sales >= 20) out.push({ icon: '⭐', label: 'Skvělé hodnocení' });
  if (since) {
    const years = Math.floor((Date.now() - new Date(since).getTime()) / (365.25 * 24 * 3600 * 1000));
    if (years >= 1) out.push({ icon: '🎂', label: `${years} ${years === 1 ? 'rok' : years < 5 ? 'roky' : 'let'} na V4cards` });
  }
  return out;
}

async function getSellerSince(id: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await createPublicClient().from('profiles').select('created_at').eq('id', id).maybeSingle();
  return (data?.created_at as string | undefined) ?? null;
}

async function loadProfile(seller: Seller, row: PageRow | null): Promise<ShopProfile> {
  const [plans, verified, since] = await Promise.all([getSellerPlans([seller.id]), getVerified([seller.id]), getSellerSince(seller.id)]);
  const plan = plans.get(seller.id) ?? 'free';
  const saved = row ? configFromRow(row, seller.kind) : defaultConfig(seller.kind);
  const isVerified = verified.has(seller.id);
  return {
    seller, plan, verified: isVerified, achievements: achievementsFor(seller, since),
    badge: hasVerifiedBadge(plan, isVerified, seller.rating, seller.sales),
    saved, config: effectiveConfig(saved, plan), exists: !!row,
  };
}

export const getShopProfile = cache(async (sellerId: string): Promise<ShopProfile | null> => {
  const seller = await getSeller(sellerId);
  if (!seller) return null;
  if (!isSupabaseConfigured()) return loadProfile(seller, null);
  const { data } = await createPublicClient().from('shop_pages').select(PAGE_COLUMNS).eq('user_id', seller.id).maybeSingle();
  return loadProfile(seller, (data as PageRow | null) ?? null);
});

export const getShopProfileBySlug = cache(async (slug: string): Promise<ShopProfile | null> => {
  if (!isSupabaseConfigured() || !/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const { data } = await createPublicClient().from('shop_pages').select(PAGE_COLUMNS).eq('slug', slug).maybeSingle();
  if (!data) return null;
  const seller = await getSeller((data as PageRow).user_id);
  return seller ? loadProfile(seller, data as PageRow) : null;
});

// ---------- Data bloků ----------

export interface ShopListing {
  id: string;
  price: number;
  condition: Condition;
  language: Language;
  quantity: number;
  graded: string | null;
  createdAt: string;
  card: { id: string; slug: string; name: string; number: string; image?: string; game: GameId; setCode: string; setName: string };
}

const LISTING_COLUMNS = 'id, price_czk, condition, language, quantity, graded, created_at, cards(id, slug, name, number, image_url, card_sets(game_id, code, name))';

type ListingRow = {
  id: string; price_czk: number; condition: string; language: string; quantity: number; graded: string | null; created_at: string;
  cards: unknown;
};

function fromListingRow(l: ListingRow): ShopListing {
  const c = (Array.isArray(l.cards) ? l.cards[0] : l.cards) as { id: string; slug: string; name: string; number: string; image_url: string | null; card_sets: unknown };
  const s = (Array.isArray(c.card_sets) ? c.card_sets[0] : c.card_sets) as { game_id: GameId; code: string; name: string } | null;
  return {
    id: l.id, price: l.price_czk, condition: l.condition as Condition, language: l.language as Language, quantity: l.quantity, graded: l.graded, createdAt: l.created_at,
    card: { id: c.id, slug: c.slug, name: c.name, number: c.number, image: c.image_url ?? undefined, game: s?.game_id ?? 'pokemon', setCode: s?.code ?? '', setName: s?.name ?? '' },
  };
}

/** Nabídky prodejce: vybrané podle id (v daném pořadí), nejnovější nebo nejlevnější. */
export async function getShopListings(sellerId: string, opts: { ids?: string[]; order?: 'new' | 'cheap'; maxPrice?: number; limit?: number }): Promise<ShopListing[]> {
  if (!isSupabaseConfigured()) return [];
  let q = createPublicClient().from('listings').select(LISTING_COLUMNS).eq('seller_id', sellerId).gt('quantity', 0);
  if (opts.ids) {
    if (!opts.ids.length) return [];
    q = q.in('id', opts.ids);
  }
  if (opts.maxPrice) q = q.lte('price_czk', opts.maxPrice);
  q = opts.order === 'cheap' ? q.order('price_czk') : q.order('created_at', { ascending: false });
  const { data } = await q.limit(opts.limit ?? 12);
  const rows = ((data ?? []) as ListingRow[]).map(fromListingRow);
  if (opts.ids) {
    const at = new Map(opts.ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  }
  return rows;
}

export interface ListingFilter {
  q?: string;
  game?: GameId;
  /** Kód sady */
  set?: string;
  condition?: Condition;
  language?: Language;
  priceMin?: number | null;
  priceMax?: number | null;
  /** Jen tyto nabídky (ruční kolekce, Doporučujeme) */
  ids?: string[];
  sort?: 'new' | 'cheap' | 'expensive';
  page?: number;
  pageSize?: number;
}

/** Nabídka prodejce po jednotlivých nabídkách (s cenou, stavem a štítky) pro Celou nabídku, kolekce a bloky. */
export async function searchShopListings(sellerId: string, f: ListingFilter): Promise<{ items: ShopListing[]; total: number }> {
  if (!isSupabaseConfigured()) return { items: [], total: 0 };
  if (f.ids && !f.ids.length) return { items: [], total: 0 };
  const text = (f.q ?? '').replace(/[%_,()*\\]/g, ' ').trim().slice(0, 60);
  // Filtry na kartu a sadu potřebují vnitřní spojení, jinak by vracely nabídky bez karty.
  const inner = text || f.game || f.set;
  const cols = inner
    ? 'id, price_czk, condition, language, quantity, graded, created_at, cards!inner(id, slug, name, number, image_url, card_sets!inner(game_id, code, name))'
    : LISTING_COLUMNS;
  let q = createPublicClient().from('listings').select(cols, { count: 'exact' }).eq('seller_id', sellerId).gt('quantity', 0);
  if (f.ids) q = q.in('id', f.ids.slice(0, 60));
  if (text) q = q.ilike('cards.name', `%${text}%`);
  if (f.game) q = q.eq('cards.card_sets.game_id', f.game);
  if (f.set) q = q.eq('cards.card_sets.code', f.set);
  if (f.condition) q = q.eq('condition', f.condition);
  if (f.language) q = q.eq('language', f.language);
  if (f.priceMin) q = q.gte('price_czk', f.priceMin);
  if (f.priceMax) q = q.lte('price_czk', f.priceMax);
  q = f.sort === 'cheap' ? q.order('price_czk') : f.sort === 'expensive' ? q.order('price_czk', { ascending: false }) : q.order('created_at', { ascending: false });
  const size = f.pageSize ?? 24;
  const page = Math.max(1, f.page ?? 1);
  const { data, count } = await q.range((page - 1) * size, page * size - 1);
  return { items: ((data ?? []) as unknown as ListingRow[]).map(fromListingRow), total: count ?? 0 };
}

export interface CatalogCardRef {
  id: string; slug: string; name: string; number: string; image?: string; game: GameId; setCode: string; setName: string;
}

export async function getCardsByIds(ids: string[]): Promise<Map<string, CatalogCardRef>> {
  const out = new Map<string, CatalogCardRef>();
  if (!isSupabaseConfigured() || !ids.length) return out;
  const { data } = await createPublicClient().from('cards').select('id, slug, name, number, image_url, card_sets(game_id, code, name)').in('id', ids.slice(0, 50));
  for (const c of data ?? []) {
    const s = (Array.isArray(c.card_sets) ? c.card_sets[0] : c.card_sets) as { game_id: GameId; code: string; name: string } | null;
    out.set(c.id, { id: c.id, slug: c.slug, name: c.name, number: c.number, image: c.image_url ?? undefined, game: s?.game_id ?? 'pokemon', setCode: s?.code ?? '', setName: s?.name ?? '' });
  }
  return out;
}

export async function getGameCounts(sellerId: string): Promise<{ game: GameId; cards: number }[]> {
  if (!isSupabaseConfigured()) return [];
  const { data } = await createPublicClient().rpc('seller_game_counts', { p_seller: sellerId });
  return ((data ?? []) as { game_id: GameId; cards: number }[]).map((r) => ({ game: r.game_id, cards: r.cards }));
}

export interface ProShop {
  id: string; name: string; kind: Seller['kind']; slug: string; tagline: string; logo: string | null; color: string; offers: number;
}

export async function getProShops(limit = 6): Promise<ProShop[]> {
  if (!isSupabaseConfigured()) return [];
  const { data } = await createPublicClient().rpc('pro_shops', { p_limit: limit });
  return ((data ?? []) as { user_id: string; display_name: string; kind: string; slug: string; tagline: string | null; logo_path: string | null; design: { color?: string } | null; offers: number }[])
    .map((r) => ({ id: r.user_id, name: r.display_name, kind: r.kind as Seller['kind'], slug: r.slug, tagline: r.tagline ?? '', logo: mediaImage(r.logo_path, 256), color: r.design?.color ?? 'blue', offers: r.offers }));
}

// ---------- Nabídky u karty ----------

export interface OfferBrand {
  plan: Plan;
  badge: boolean;
  /** Logo u nabídky (Plus a Pro); null = iniciály na barvě obchodu */
  logo: string | null;
  color: string;
  /** Vzkaz pod jménem (Pro) */
  note: string;
  /** Kam vede jméno prodejce */
  href: string;
}

/** Tarif, odznak, logo a odkaz pro prodejce v nabídkách u karty. */
export async function getOfferBrands(sellers: Seller[]): Promise<Map<string, OfferBrand>> {
  const ids = [...new Set(sellers.map((s) => s.id))];
  const [plans, verified, brands] = await Promise.all([getSellerPlans(ids), getVerified(ids), getSellerBrands(ids)]);
  const out = new Map<string, OfferBrand>();
  for (const s of sellers) {
    if (out.has(s.id)) continue;
    const plan = plans.get(s.id) ?? 'free';
    const info = PLANS[plan];
    const b = brands.get(s.id);
    out.set(s.id, {
      plan,
      badge: hasVerifiedBadge(plan, verified.has(s.id), s.rating, s.sales),
      logo: info.offerLogo ? b?.logo ?? null : null,
      color: b?.color ?? 'blue',
      note: info.offerHighlight ? b?.note ?? '' : '',
      href: info.shopPage && b?.published && b.slug ? shopHref(s.kind, b.slug) : `/prodejci/${s.id}`,
    });
  }
  return out;
}

const CONDITION_RANK = new Map(CONDITIONS.map((c, i) => [c, i]));

/**
 * Pořadí nabídek: cena, pak lepší stav, a teprve při stejné ceně i stavu má přednost Pro.
 * Pro tak nikdy nepředběhne levnější ani zachovalejší nabídku.
 */
export function sortOffers<T extends { price: number; condition: Condition; seller: { id: string } }>(offers: T[], brands: Map<string, OfferBrand>): T[] {
  return offers
    .map((o, i) => ({ o, i }))
    .sort((a, b) =>
      a.o.price - b.o.price
      || (CONDITION_RANK.get(a.o.condition) ?? 9) - (CONDITION_RANK.get(b.o.condition) ?? 9)
      || Number(brands.get(b.o.seller.id)?.plan === 'pro') - Number(brands.get(a.o.seller.id)?.plan === 'pro')
      || a.i - b.i)
    .map((x) => x.o);
}

export interface ShopReview {
  rating: number;
  comment: string;
  date: string;
}

/** Kladná hodnocení s komentářem pro blok Recenze (bez jmen kupujících). */
export async function getShopReviews(sellerId: string, limit: number): Promise<ShopReview[]> {
  if (!isSupabaseConfigured()) return [];
  const { data } = await createPublicClient()
    .from('reviews')
    .select('rating, comment, created_at')
    .eq('seller_id', sellerId)
    .gte('rating', 4)
    .not('comment', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? [])
    .filter((r) => (r.comment as string | null)?.trim())
    .map((r) => ({ rating: r.rating as number, comment: (r.comment as string).trim().slice(0, 400), date: r.created_at as string }));
}
