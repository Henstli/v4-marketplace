'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { thumbUrl } from '@/lib/images';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';
import { loadCards, type WatchRules } from './history';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOLD = ['confirmed', 'pending_payment', 'paid', 'shipped', 'delivered'];
type Item = { l: string; c: string | null; p0: number | null; p1: number | null; q0: number; q1: number; s0: number | null; s1: number | null; loc0: string | null; loc1: string | null };
const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

export interface CardTimeline { at: string; kind: 'sale' | 'price' | 'stock' | 'inv'; title: string; detail: string; impact: number | null; arrow: boolean }
export interface CardHistory {
  listing: string;
  name: string; image: string | null; set: string; cond: string; lang: string; loc: string | null;
  total: number; forSale: number; sold: number; price: number | null;
  /** Vaše cena v čase (od nejstaršího), trh po dnech, prodeje */
  priceSteps: { at: string; p: number | null }[];
  market: { day: string; p: number }[];
  sales: { at: string; p: number; q: number }[];
  timeline: CardTimeline[];
}

const kc = (n: number | null) => (n == null ? 'dohodou' : `${n.toLocaleString('cs-CZ')} Kč`);

/** Historie jedné karty skladu: údaje, graf ceny a trhu za 90 dní a všechno, co se s ní dělo. */
export async function historyCard(listing: string): Promise<CardHistory | { error: string }> {
  if (!UUID.test(listing)) return { error: 'Karta nenalezena.' };
  const supabase = await createClient();
  const { data: l } = await supabase.from('listings')
    .select('id, card_id, seller_id, price_czk, quantity, condition, language, listing_stock(keep_qty, location), cards(name, image_url, card_sets(name))')
    .eq('id', listing).maybeSingle();
  if (!l) return { error: 'Karta nenalezena.' };
  const st = one(l.listing_stock as { keep_qty: number; location: string | null } | { keep_qty: number; location: string | null }[] | null);
  const card = one(l.cards as unknown as { name: string; image_url: string | null; card_sets: { name: string } | { name: string }[] | null } | null);
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const [{ data: evs }, { data: oi }, { data: ph }] = await Promise.all([
    supabase.from('stock_events').select('id, kind, title, created_at, actor_id, items, reverts_id')
      .eq('owner_id', l.seller_id).contains('items', [{ l: listing }]).order('created_at', { ascending: false }).limit(200),
    supabase.from('order_items').select('quantity, price_czk, orders!inner(number, status, created_at, decided_at)').eq('listing_id', listing).limit(500),
    supabase.from('price_history').select('day, avg_price_czk').eq('card_id', l.card_id).gte('day', since).order('day'),
  ]);
  type E = { id: number; kind: string; title: string; created_at: string; actor_id: string | null; items: Item[]; reverts_id: number | null };
  const events = (evs ?? []) as E[];
  const actorIds = [...new Set(events.map((e) => e.actor_id).filter(Boolean) as string[])];
  const { data: profs } = actorIds.length ? await supabase.from('profiles').select('id, display_name').in('id', actorIds) : { data: [] };
  const who = new Map(((profs ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  type O = { quantity: number; price_czk: number; orders: { number: number; status: string; created_at: string; decided_at: string | null } | { number: number; status: string; created_at: string; decided_at: string | null }[] };
  const sales = ((oi ?? []) as O[]).map((x) => ({ ...x, o: one(x.orders)! })).filter((x) => x.o && SOLD.includes(x.o.status));

  const timeline: CardTimeline[] = [];
  for (const e of events) {
    const it = e.items.find((x) => x.l === listing);
    if (!it) continue;
    const by = e.actor_id ? who.get(e.actor_id) ?? 'člen týmu' : 'automaticky';
    const multi = e.items.length > 1;
    const src = /^Inventura /.test(e.title) ? 'inv' : e.kind === 'price' ? 'price' : 'stock';
    let title: string;
    const d = it.q1 - it.q0;
    if (src === 'inv') title = d === 0 ? `Inventura: sedí, ${it.q1} ks` : `Inventura: ${d > 0 ? '+' : ''}${d} ks`;
    else if (e.kind === 'price' || (d === 0 && it.p0 !== it.p1)) title = `Cena ${kc(it.p0)} → ${kc(it.p1)}`;
    else if (d > 0) title = `Přidáno ${d} ks`;
    else if (d < 0) title = `Odebráno ${-d} ks`;
    else if ((it.loc0 ?? '') !== (it.loc1 ?? '')) title = `Přesunuto ${it.loc0 || 'bez místa'} → ${it.loc1 || 'bez místa'}`;
    else title = e.title.replace(/^Vráceno: /, '');
    if (e.reverts_id) title = `Vráceno: ${title}`;
    const why = multi ? (e.actor_id ? `${e.title.replace(/^Vráceno: /, '').split(' · ')[0].toLowerCase()} · ${by}` : e.title.split(' · ')[0].toLowerCase()) : by;
    const imp = src === 'price' || (d === 0 && it.p0 !== it.p1) ? (it.p0 != null && it.p1 != null ? it.p1 - it.p0 : null)
      : d !== 0 && (it.p0 ?? it.p1) ? d * (it.p0 ?? it.p1)! : null;
    timeline.push({ at: e.created_at, kind: src === 'inv' ? 'inv' : src === 'price' || title.startsWith('Cena') ? 'price' : 'stock', title,
      detail: [src === 'inv' ? it.loc1 : null, why].filter(Boolean).join(' · '), impact: imp || null, arrow: src === 'price' || title.startsWith('Cena') || (imp ?? 0) < 0 });
  }
  for (const s of sales) {
    timeline.push({ at: s.o.decided_at ?? s.o.created_at, kind: 'sale', title: `Prodáno ${s.quantity} ks za ${kc(s.price_czk)}`,
      detail: `objednávka č. ${s.o.number}`, impact: s.quantity * s.price_czk, arrow: true });
  }
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  // Vaše cena v čase: od dnešní ceny zpět přes změny ceny.
  const steps: { at: string; p: number | null }[] = [{ at: new Date().toISOString(), p: l.price_czk }];
  let cur = l.price_czk as number | null;
  for (const e of events) {
    const it = e.items.find((x) => x.l === listing);
    if (!it || it.p0 === it.p1) continue;
    steps.push({ at: e.created_at, p: it.p1 ?? cur });
    cur = it.p0;
  }
  steps.push({ at: new Date(Date.now() - 90 * 864e5).toISOString(), p: cur });
  steps.reverse();

  const set = one(card?.card_sets ?? null)?.name ?? '';
  return {
    listing, name: card?.name ?? 'Karta', image: thumbUrl(card?.image_url ?? undefined) ?? null, set,
    cond: l.condition as string, lang: LANGUAGE_NAMES[l.language as Language] ?? (l.language as string), loc: st?.location ?? null,
    total: (l.quantity as number) + (st?.keep_qty ?? 0), forSale: l.quantity as number,
    sold: sales.reduce((a, s) => a + s.quantity, 0), price: l.price_czk as number | null,
    priceSteps: steps.filter((s) => s.at >= new Date(Date.now() - 90 * 864e5 - 1000).toISOString()),
    market: ((ph ?? []) as { day: string; avg_price_czk: number | null }[]).filter((x) => x.avg_price_czk).map((x) => ({ day: x.day, p: x.avg_price_czk! })),
    sales: sales.filter((s) => (s.o.decided_at ?? s.o.created_at) >= new Date(Date.now() - 90 * 864e5).toISOString())
      .map((s) => ({ at: s.o.decided_at ?? s.o.created_at, p: s.price_czk, q: s.quantity })),
    timeline,
  };
}

export interface EventRow { l: string; name: string; image: string | null; cond: string; loc: string | null; p0: number | null; p1: number | null; q0: number; q1: number; market: number | null }
export interface EventDetail { id: number; kind: string; title: string; detail: string | null; at: string; auto: boolean; canUndo: boolean; rows: EventRow[] }

async function markets(supabase: Awaited<ReturnType<typeof createClient>>, cardIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(cardIds)];
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  for (let i = 0; i < ids.length; i += 150) {
    const part = ids.slice(i, i + 150);
    const [{ data: ph }, { data: cm }] = await Promise.all([
      supabase.from('price_history').select('card_id, day, avg_price_czk').in('card_id', part).gte('day', since).order('day'),
      supabase.from('card_market').select('card_id, min_price').in('card_id', part),
    ]);
    for (const m of (cm ?? []) as { card_id: string; min_price: number | null }[]) if (m.min_price) out.set(m.card_id, m.min_price);
    for (const h of (ph ?? []) as { card_id: string; avg_price_czk: number | null }[]) if (h.avg_price_czk) out.set(h.card_id, h.avg_price_czk);
  }
  return out;
}

/** Detail hromadné změny: všechny karty s cenou před a po a trhem. */
export async function historyEvent(eventId: number): Promise<EventDetail | { error: string }> {
  if (!Number.isInteger(eventId) || eventId <= 0) return { error: 'Změna nenalezena.' };
  const supabase = await createClient();
  const { data: e } = await supabase.from('stock_events').select('id, kind, title, detail, created_at, actor_id, items, undo, undone_at').eq('id', eventId).maybeSingle();
  if (!e) return { error: 'Změna nenalezena.' };
  const items = (e.items ?? []) as Item[];
  const lids = items.map((x) => x.l);
  const conds = new Map<string, string>();
  for (let i = 0; i < lids.length; i += 150) {
    const { data } = await supabase.from('listings').select('id, condition').in('id', lids.slice(i, i + 150));
    for (const r of (data ?? []) as { id: string; condition: string }[]) conds.set(r.id, r.condition);
  }
  const cids = items.map((x) => x.c).filter(Boolean) as string[];
  const [cards, mk] = await Promise.all([loadCards(supabase, cids), markets(supabase, cids)]);
  return {
    id: e.id, kind: e.kind, title: (e.title as string), detail: e.detail, at: e.created_at, auto: !e.actor_id, canUndo: e.undo != null && !e.undone_at,
    rows: items.map((x) => ({
      l: x.l, name: (x.c && cards.get(x.c)?.name) || 'Karta', image: (x.c && cards.get(x.c)?.image) || null, cond: conds.get(x.l) ?? '',
      loc: x.loc1 ?? x.loc0, p0: x.p0, p1: x.p1, q0: x.q0, q1: x.q1, market: x.c ? mk.get(x.c) ?? null : null,
    })),
  };
}

export interface UndoRow { l: string; name: string; image: string | null; now: string; back: string; diff: number; stays: 'sold' | 'manual' | null }
export interface UndoPreview { id: number; kind: string; title: string; at: string; count: number; rows: UndoRow[]; total: number }

/** Co se při vrácení změny vrátí a co zůstane (prodané nebo mezitím ručně změněné). */
export async function historyUndoPreview(eventId: number): Promise<UndoPreview | { error: string }> {
  if (!Number.isInteger(eventId) || eventId <= 0) return { error: 'Změna nenalezena.' };
  const supabase = await createClient();
  const [{ data: e }, { data: rows, error }] = await Promise.all([
    supabase.from('stock_events').select('id, kind, title, created_at').eq('id', eventId).maybeSingle(),
    supabase.rpc('stock_undo_preview', { p_event: eventId }),
  ]);
  if (!e || error) return { error: error?.message ?? 'Změna nenalezena.' };
  type R = { l: string; card_id: string | null; p_now: number | null; p_back: number | null; q_now: number; q_back: number; stays: 'sold' | 'manual' | null };
  const rs = (rows ?? []) as R[];
  const cards = await loadCards(supabase, rs.map((r) => r.card_id).filter(Boolean) as string[]);
  const price = e.kind === 'price';
  const out: UndoRow[] = rs.map((r) => ({
    l: r.l, name: (r.card_id && cards.get(r.card_id)?.name) || 'Karta', image: (r.card_id && cards.get(r.card_id)?.image) || null,
    now: price ? kc(r.p_now) : `${r.q_now} ks`, back: price ? kc(r.p_back) : `${r.q_back} ks`,
    diff: price ? (r.p_back ?? 0) - (r.p_now ?? 0) : (r.q_back - r.q_now) * (r.p_back ?? r.p_now ?? 0), stays: r.stays,
  }));
  return { id: e.id, kind: e.kind, title: e.title, at: e.created_at, count: out.length, rows: out,
    total: out.filter((r) => !r.stays).reduce((s, r) => s + r.diff, 0) };
}

/** K prověření: označit jako v pořádku (s volitelnou poznámkou). */
export async function flagResolve(id: number, note?: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('stock_flag_resolve', { p_id: id, p_note: note ?? null });
  if (error) return { error: error.message };
  revalidatePath('/prodat');
  return {};
}

/** Co hlídat: uložit pravidla obchodu (jen vedoucí). */
export async function watchSave(owner: string, rules: WatchRules): Promise<{ error?: string }> {
  if (!UUID.test(owner)) return { error: 'Obchod nenalezen.' };
  const clean: WatchRules = {
    below_market: { on: !!rules.below_market.on, pct: clamp(rules.below_market.pct, 5, 90) },
    big_drop: { on: !!rules.big_drop.on, pct: clamp(rules.big_drop.pct, 5, 90) },
    loss: { on: !!rules.loss.on, qty: clamp(rules.loss.qty, 0, 1000), czk: clamp(rules.loss.czk, 0, 1e6) },
    inv_diff: { on: !!rules.inv_diff.on, czk: clamp(rules.inv_diff.czk, 0, 1e6) },
    off_hours: { on: !!rules.off_hours.on },
    sync_fail: { on: !!rules.sync_fail.on, n: clamp(rules.sync_fail.n, 1, 20) },
    notify_lead: !!rules.notify_lead, notify_actor: !!rules.notify_actor,
  };
  const supabase = await createClient();
  const { error } = await supabase.rpc('stock_watch_save', { p_owner: owner, p_rules: clean });
  if (error) return { error: error.message };
  revalidatePath('/prodat');
  return {};
}
function clamp(n: number, a: number, b: number) { const x = Math.round(Number(n)); return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : a; }
