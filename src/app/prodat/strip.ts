import type { SupabaseClient } from '@supabase/supabase-js';
import type { StripStats } from './StockTable';

const OPEN = ['requested', 'confirmed', 'pending_payment', 'paid'];
const SOLD = ['paid', 'shipped', 'delivered'];

/** Čísla do pruhu nad tabulkou: vývoj hodnoty, nejvíc zdražená karta, objednávky, prodeje, kdo hlídá. */
export async function loadStrip(supabase: SupabaseClient, owner: string, hasRows: boolean, opts: { watchers: boolean }): Promise<StripStats> {
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const [rise, open, sold, demand] = await Promise.all([
    hasRows ? supabase.rpc('stock_riser', { p_owner: owner }) : Promise.resolve({ data: null }),
    supabase.from('orders').select('status, payment').eq('seller_id', owner).in('status', OPEN).limit(1000),
    supabase.from('orders').select('total_czk, order_items(quantity)').eq('seller_id', owner).in('status', SOLD).gte('created_at', since30).limit(1000),
    opts.watchers ? supabase.rpc('market_demand', { p_owner: owner }) : Promise.resolve({ data: null }),
  ]);

  // Vývoj hodnoty a nejvíc zdražená karta za 30 dní (počítá databáze z denních tržních cen).
  const r = ((rise.data ?? []) as { trend: number | string | null; card_id: string | null; name: string | null; from_czk: number | null; to_czk: number | null }[])[0];
  const trend = r?.trend != null ? Number(r.trend) : null;
  const riser: StripStats['riser'] = r?.card_id && r.from_czk && r.to_czk
    ? { name: r.name ?? 'Karta', cardId: r.card_id, from: r.from_czk, to: r.to_czk, pct: Math.round((r.to_czk / r.from_czk - 1) * 100) }
    : null;

  const o = (open.data ?? []) as { status: string; payment: string | null }[];
  const s = (sold.data ?? []) as { total_czk: number; order_items: { quantity: number }[] }[];
  const d = (demand.data ?? null) as { wanters: number; on_sale?: number }[] | null;
  return {
    trend,
    riser,
    orders: o.length,
    ordersWaiting: o.filter((x) => x.status === 'requested').length,
    unpaid: o.filter((x) => x.status === 'pending_payment').length,
    sold30: { pcs: s.reduce((t, x) => t + (x.order_items ?? []).reduce((u, i) => u + i.quantity, 0), 0), sum: s.reduce((t, x) => t + x.total_czk, 0) },
    watchers: d ? d.filter((x) => (x.on_sale ?? 0) > 0).reduce((t, x) => t + x.wanters, 0) : null,
  };
}
