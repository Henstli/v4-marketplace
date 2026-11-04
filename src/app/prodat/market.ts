import type { SupabaseClient } from '@supabase/supabase-js';
import { loadStock } from './data';

export type MarketView = 'poptavka' | 'trh' | 'ceny' | 'automaticke';

export interface DemandCard {
  cardId: string; slug: string; name: string; set: string; image: string | null; game: string | null;
  wanters: number; recent: number; onSale: number; keep: number; market: number | null; low: number | null; offers?: number;
}

export interface PriceRow {
  id: string; slug: string | null; name: string; set: string; image: string | null; condition: string; language: string;
  quantity: number; price: number; market: number | null; low: number | null; days: number | null; recommended: number | null;
}

export interface AutoRules {
  enabled: boolean; mode: 'under' | 'market' | 'over'; pct: number; floorPct: number; capPct: number;
  exclLocations: string[]; exclGames: string[]; lastRun: string | null;
}
export interface AutoChange { id: string; name: string; set: string; condition: string; old: number; next: number; market: number; reason: string }

type DemandRaw = {
  card_id: string; slug: string; name: string; set_code: string; number: string; image_url: string | null; game_id: string | null;
  wanters: number; recent: number; on_sale?: number; keep?: number; market_czk: number | null; low_czk: number | null; offers?: number;
};
const demand = (d: DemandRaw): DemandCard => ({
  cardId: d.card_id, slug: d.slug, name: d.name, set: `${d.set_code} ${d.number}`.trim(), image: d.image_url, game: d.game_id,
  wanters: d.wanters, recent: d.recent, onSale: d.on_sale ?? 0, keep: d.keep ?? 0, market: d.market_czk, low: d.low_czk, offers: d.offers,
});

/** Poptávka u obchodu: co lidé hledají nebo hlídají a kolik toho obchod má. */
export async function loadDemand(supabase: SupabaseClient, owner: string): Promise<DemandCard[]> {
  const { data } = await supabase.rpc('market_demand', { p_owner: owner });
  return ((data ?? []) as DemandRaw[]).map(demand);
}

/** Celý trh: nejhledanější karty a poptávka podle her (jen souhrnná čísla). */
export async function loadMarket(supabase: SupabaseClient, days: number) {
  const [top, games] = await Promise.all([
    supabase.rpc('market_top', { p_days: days }),
    supabase.rpc('market_games', { p_days: days }),
  ]);
  return {
    top: ((top.data ?? []) as DemandRaw[]).map(demand),
    games: (games.data ?? []) as { game_id: string; wanters: number; recent: number }[],
  };
}

/**
 * Vaše ceny: karty na prodej proti trhu. Doporučená = trh −3 % (leží přes 60 dní −5 %),
 * nikdy pod nejlevnější nabídkou jiného prodejce ve stejném stavu a jazyce.
 */
export async function loadPrices(supabase: SupabaseClient, owner: string): Promise<PriceRow[]> {
  const [stock, { data }] = await Promise.all([loadStock(supabase, owner), supabase.rpc('market_prices', { p_owner: owner })]);
  const low = new Map(((data ?? []) as { listing_id: string; low_same: number | null; low_any: number | null }[]).map((r) => [r.listing_id, r.low_same]));
  return stock.filter((r) => r.quantity > 0 && r.price != null && !r.removed && r.hidden == null).map((r) => {
    const days = r.listedAt ? Math.floor((Date.now() - new Date(r.listedAt).getTime()) / 86400000) : null;
    const l = low.get(r.id) ?? null;
    const rec = r.market != null ? Math.max(1, Math.round(r.market * (days != null && days > 60 ? 0.95 : 0.97)), l ?? 0) : null;
    return {
      id: r.id, slug: r.card?.slug ?? null, name: r.card?.name ?? 'Karta', set: `${r.card?.setCode ?? ''} ${r.card?.number ?? ''}`.trim(),
      image: r.card?.image ?? null, condition: r.condition, language: r.language, quantity: r.quantity, price: r.price!,
      market: r.market, low: l, days, recommended: rec,
    };
  });
}

/** Automatické ceny: pravidla obchodu a náhled, co se změní dnes v noci. */
export async function loadAuto(supabase: SupabaseClient, owner: string): Promise<{ rules: AutoRules; changes: AutoChange[] }> {
  const [{ data: r }, { data: p }] = await Promise.all([
    supabase.from('stock_autoprice').select('*').eq('owner_id', owner).maybeSingle(),
    supabase.rpc('stock_autoprice_preview', { p_owner: owner }),
  ]);
  const rules: AutoRules = {
    enabled: !!r?.enabled, mode: (r?.mode ?? 'under') as AutoRules['mode'], pct: Number(r?.pct ?? 2), floorPct: r?.floor_pct ?? 10, capPct: r?.cap_pct ?? 15,
    exclLocations: r?.excl_locations ?? [], exclGames: r?.excl_games ?? [], lastRun: r?.last_run_at ?? null,
  };
  // Náhled je prázdný, dokud obchod pravidla neuloží.
  const changes = ((p ?? []) as { listing_id: string; name: string; set_code: string; condition: string; old_price: number; new_price: number; market_czk: number; reason: string }[])
    .map((c) => ({ id: c.listing_id, name: c.name, set: c.set_code, condition: c.condition, old: c.old_price, next: c.new_price, market: c.market_czk, reason: c.reason }));
  return { rules, changes };
}
