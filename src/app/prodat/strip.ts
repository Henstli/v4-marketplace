import type { SupabaseClient } from '@supabase/supabase-js';
import { owned, type StockRow } from './data';
import type { StripStats } from './StockTable';

const OPEN = ['requested', 'confirmed', 'pending_payment', 'paid'];
const SOLD = ['paid', 'shipped', 'delivered'];

/** Čísla do pruhu nad tabulkou: vývoj hodnoty, nejvíc zdražená karta, objednávky, prodeje, kdo hlídá. */
export async function loadStrip(supabase: SupabaseClient, owner: string, rows: StockRow[], opts: { watchers: boolean }): Promise<StripStats> {
  const have = new Map<string, number>();
  const names = new Map<string, string>();
  for (const r of rows) {
    const n = owned(r);
    if (n <= 0) continue;
    have.set(r.cardId, (have.get(r.cardId) ?? 0) + n);
    names.set(r.cardId, r.card?.name ?? 'Karta');
  }
  const ids = [...have.keys()];
  const since = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const [ph, open, sold, demand] = await Promise.all([
    ids.length && ids.length <= 1500
      ? supabase.from('price_history').select('card_id, day, avg_price_czk').in('card_id', ids).gte('day', since).order('day').limit(50000)
      : Promise.resolve({ data: [] as { card_id: string; day: string; avg_price_czk: number }[] }),
    supabase.from('orders').select('status, payment').eq('seller_id', owner).in('status', OPEN).limit(1000),
    supabase.from('orders').select('total_czk, order_items(quantity)').eq('seller_id', owner).in('status', SOLD).gte('created_at', since30).limit(1000),
    opts.watchers ? supabase.rpc('market_demand', { p_owner: owner }) : Promise.resolve({ data: null }),
  ]);

  // První a poslední tržní cena za 30 dní u každé karty.
  const first = new Map<string, number>(), last = new Map<string, number>();
  for (const p of (ph.data ?? []) as { card_id: string; avg_price_czk: number }[]) {
    if (!first.has(p.card_id)) first.set(p.card_id, p.avg_price_czk);
    last.set(p.card_id, p.avg_price_czk);
  }
  let a = 0, b = 0;
  let riser: StripStats['riser'] = null;
  for (const [id, f] of first) {
    const l = last.get(id)!;
    const n = have.get(id) ?? 0;
    a += f * n; b += l * n;
    const pct = f ? Math.round((l / f - 1) * 100) : 0;
    if (pct > 0 && (!riser || pct > riser.pct)) riser = { name: names.get(id) ?? 'Karta', pct, cardId: id };
  }
  const trend = a > 0 && first.size > 0 ? Math.round(((b / a) - 1) * 1000) / 10 : null;

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
