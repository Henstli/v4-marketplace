import type { createClient } from '@/lib/supabase/server';
import { thumbUrl } from '@/lib/images';
import { fold } from '@/lib/import/columns';
import { plural } from '@/lib/format';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type HKind = 'sale' | 'stock' | 'price' | 'sync' | 'inv';
export type HIcon = 'sale' | 'add' | 'remove' | 'move' | 'price' | 'undo' | 'inv' | 'stock' | 'sync';

/** Jeden řádek Historie (změna skladu, prodej nebo inventura). */
export interface HEntry {
  key: string;
  kind: HKind;
  icon: HIcon;
  title: string;
  detail: string | null;
  at: string;
  /** Kdo změnu udělal; null = automaticky (auto říká co) */
  who: string | null;
  auto: string | null;
  eventId: number | null;
  canUndo: boolean;
  undoneAt: string | null;
  undoneBy: string | null;
  revertsId: number | null;
  revertsAt: string | null;
  /** Dopad v Kč; arrow = ▲/▼ s barvou, jinak neutrální hodnota */
  impact: number | null;
  arrow: boolean;
  thumbs: string[];
  /** Počet karet u změny (víc než 1 = hromadná změna) */
  multi: number;
  /** Řádek skladu u změny jedné karty (otevře historii karty) */
  listing: string | null;
  places: string[];
  /** Kusů přibylo / ubylo */
  plus: number;
  minus: number;
  hromadne: boolean;
  flagged: boolean;
  href: string | null;
  search: string;
}

/** Nález K prověření. */
export interface HFlag {
  id: number;
  eventId: number | null;
  rule: string;
  title: string;
  tag: string | null;
  detail: string | null;
  impact: number | null;
  who: string | null;
  at: string;
  thumb: string | null;
  listing: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: 'ok' | 'undone' | 'auto' | null;
  note: string | null;
  /** Co nabídnout k vrácení (jen když jde změna vrátit) */
  undoLabel: string | null;
}

export interface WatchRules {
  below_market: { on: boolean; pct: number };
  big_drop: { on: boolean; pct: number };
  loss: { on: boolean; qty: number; czk: number };
  inv_diff: { on: boolean; czk: number };
  off_hours: { on: boolean };
  sync_fail: { on: boolean; n: number };
  notify_lead: boolean;
  notify_actor: boolean;
}

export type PeriodKey = 'dnes' | '7' | '30' | 'rok' | 'vlastni';
export interface Period { key: PeriodKey; from: string; to: string; od: string; do: string; label: string }

export interface HData {
  entries: HEntry[];
  flags: HFlag[];
  rules: WatchRules | null;
  hoursText: string;
  lead: boolean;
  period: Period;
}

// ---------- Čas v Praze ----------

const TZ = 'Europe/Prague';
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Dnešní datum v Praze jako YYYY-MM-DD. */
export const pragueYmd = (d = new Date()) => ymdFmt.format(d);
function offsetMin(d: Date): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(d).reduce<Record<string, number>>((a, x) => (x.type !== 'literal' ? { ...a, [x.type]: Number(x.value) } : a), {});
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - d.getTime()) / 60000;
}
/** Půlnoc daného dne v Praze. */
export function pragueMidnight(ymd: string): Date {
  const guess = new Date(`${ymd}T00:00:00Z`);
  return new Date(guess.getTime() - offsetMin(guess) * 60000);
}
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const fmtDay = (ymd: string, year = false) => { const [y, m, d] = ymd.split('-').map(Number); return `${d}. ${m}.${year ? ` ${y}` : ''}`; };

/** Období z adresy: dnes, 7 dní (výchozí), 30 dní, rok, nebo vlastní od–do (jeden den = od a do stejné). */
export function parsePeriod(obdobi?: string, od?: string, doo?: string): Period {
  const today = pragueYmd();
  const min = addDays(today, -365);
  let key: PeriodKey = obdobi === 'dnes' || obdobi === '30' || obdobi === 'rok' || obdobi === 'vlastni' ? obdobi : '7';
  let a = today, b = today;
  if (key === 'vlastni' && od && YMD.test(od)) {
    a = od < min ? min : od > today ? today : od;
    b = doo && YMD.test(doo) ? (doo > today ? today : doo) : a;
    if (b < a) [a, b] = [b, a];
  } else {
    if (key === 'vlastni') key = '7';
    a = key === 'dnes' ? today : key === '30' ? addDays(today, -29) : key === 'rok' ? addDays(today, -364) : addDays(today, -6);
  }
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  const label = a === b ? fmtDay(a, true) : `${fmtDay(a, !sameYear)} – ${fmtDay(b, true)}`;
  return { key, from: pragueMidnight(a).toISOString(), to: pragueMidnight(addDays(b, 1)).toISOString(), od: a, do: b, label };
}

// ---------- Otevírací doba ----------

const DAYS: Record<string, number> = { po: 1, ut: 2, út: 2, st: 3, ct: 4, čt: 4, pa: 5, pá: 5, so: 6, ne: 7 };
/** Otevírací doba obchodu (volný text „Po–Pá“, „10:00–18:00“) jako [{d:[1..7], f, t}] pro hlídání změn mimo ni. */
export function parseHours(hours: { day: string; time: string }[] | null | undefined): { d: number[]; f: string; t: string }[] {
  const out: { d: number[]; f: string; t: string }[] = [];
  for (const h of hours ?? []) {
    const tm = /(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/.exec(h.time ?? '');
    if (!tm) continue;
    const parts = (h.day ?? '').toLowerCase().split(/[,;]/);
    const d = new Set<number>();
    for (const p of parts) {
      const m = p.match(/(po|út|ut|st|čt|ct|pá|pa|so|ne)/g);
      if (!m) continue;
      if (m.length >= 2 && /[–—-]/.test(p)) {
        const s = DAYS[m[0]], e = DAYS[m[1]];
        for (let i = s; i <= (e >= s ? e : e + 7); i++) d.add(((i - 1) % 7) + 1);
      } else for (const x of m) d.add(DAYS[x]);
    }
    if (!d.size) continue;
    const pad = (x: string) => x.padStart(2, '0');
    out.push({ d: [...d].sort(), f: `${pad(tm[1])}:${tm[2]}`, t: `${pad(tm[3])}:${tm[4]}` });
  }
  return out;
}

// ---------- Načtení ----------

type Item = { l: string; c: string | null; p0: number | null; p1: number | null; q0: number; q1: number; s0: number | null; s1: number | null; loc0: string | null; loc1: string | null };
type Ev = {
  id: number; kind: string; title: string; detail: string | null; created_at: string; undo: unknown; items: Item[] | null; impact_czk: number | null;
  reverts_id: number | null; undone_at: string | null; undone_by: string | null; actor_id: string | null;
};
type CardInfo = { id: string; name: string; image: string | null };

const kc = (n: number | null) => (n == null ? 'dohodou' : `${n.toLocaleString('cs-CZ')} Kč`);
const SOLD = ['confirmed', 'pending_payment', 'paid', 'shipped', 'delivered'];

export async function loadCards(supabase: Supabase, ids: string[]): Promise<Map<string, CardInfo>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, CardInfo>();
  for (let i = 0; i < uniq.length; i += 150) {
    const { data } = await supabase.from('cards').select('id, name, image_url').in('id', uniq.slice(i, i + 150));
    for (const c of (data ?? []) as { id: string; name: string; image_url: string | null }[]) out.set(c.id, { id: c.id, name: c.name, image: thumbUrl(c.image_url ?? undefined) ?? null });
  }
  return out;
}

/** Popis změny jedné karty z jejího stavu před a po. */
function describe(kind: string, it: Item, name: string, stored: string): { title: string; icon: HIcon; detail?: string } {
  if (kind === 'price') return { title: `${name} ${kc(it.p0)} → ${kc(it.p1)}`, icon: 'price' };
  const d = it.q1 - it.q0;
  if (d > 0) return { title: `Přidáno ${d}× ${name}`, icon: 'add' };
  if (d < 0) return { title: `Odebráno ${-d}× ${name}`, icon: 'remove' };
  if ((it.loc0 ?? '') !== (it.loc1 ?? '')) return { title: `Přesunuto ${it.q1}× ${name}`, icon: 'move', detail: `${it.loc0 || 'bez místa'} → ${it.loc1 || 'bez místa'}` };
  if (it.p0 !== it.p1) return { title: `${name} ${kc(it.p0)} → ${kc(it.p1)}`, icon: 'price' };
  return { title: stored, icon: 'stock' };
}

export async function loadHistory(supabase: Supabase, owner: string, shop: boolean, period: Period): Promise<HData> {
  // K prověření: nejdřív projít nové změny podle pravidel (jen obchod, rychlé, bere jen neprověřené).
  let hoursText = '';
  if (shop) {
    const { data: page } = await supabase.from('shop_pages').select('store').eq('user_id', owner).maybeSingle();
    const hours = ((page as { store?: { hours?: { day: string; time: string }[] } } | null)?.store?.hours) ?? [];
    hoursText = hours.map((h) => `${h.day} ${h.time}`).join(', ');
    const parsed = parseHours(hours);
    const { error } = await supabase.rpc('stock_flags_check', { p_owner: owner, p_hours: parsed.length ? parsed : null });
    if (error) console.error('stock_flags_check', error.message);
  }

  const [{ data: evs }, { data: orders }, { data: invs }, flagsR, rulesR, leadR] = await Promise.all([
    supabase.from('stock_events').select('id, kind, title, detail, created_at, undo, items, impact_czk, reverts_id, undone_at, undone_by, actor_id')
      .eq('owner_id', owner).gte('created_at', period.from).lt('created_at', period.to).order('created_at', { ascending: false }).limit(3000),
    supabase.from('orders').select('id, number, total_czk, shipping_czk, status, created_at, decided_at, order_items(quantity, price_czk, card_id, listing_id)')
      .eq('seller_id', owner).in('status', SOLD).gte('created_at', period.from).lt('created_at', period.to).order('created_at', { ascending: false }).limit(1000),
    shop ? supabase.from('inventories').select('id, place, user_id, status, finished_at, lines')
      .eq('owner_id', owner).in('status', ['review', 'done']).gte('finished_at', period.from).lt('finished_at', period.to).limit(300)
      : Promise.resolve({ data: [] as never[] }),
    shop ? supabase.from('stock_flags').select('id, event_id, rule, title, tag, detail, impact_czk, actor_id, card_id, at, resolved_at, resolved_by, resolution, note')
      .eq('owner_id', owner).or(`resolved_at.is.null,at.gte."${period.from}"`).order('at', { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as never[] }),
    shop ? supabase.rpc('stock_watch_rules', { p_owner: owner }) : Promise.resolve({ data: null }),
    shop ? supabase.rpc('stock_lead', { p_owner: owner }) : Promise.resolve({ data: true }),
  ]);
  const events = (evs ?? []) as Ev[];
  type FlagRow = { id: number; event_id: number | null; rule: string; title: string; tag: string | null; detail: string | null; impact_czk: number | null;
    actor_id: string | null; card_id: string | null; at: string; resolved_at: string | null; resolved_by: string | null; resolution: HFlag['resolution']; note: string | null };
  const flagRows = ((flagsR.data ?? []) as FlagRow[]);
  type Ord = { id: string; number: number; total_czk: number; shipping_czk: number | null; created_at: string; decided_at: string | null;
    order_items: { quantity: number; price_czk: number; card_id: string | null; listing_id: string | null }[] };
  const ords = (orders ?? []) as Ord[];
  type Inv = { id: number; place: string; user_id: string | null; status: string; finished_at: string | null; lines: { expected: number; counted: number | null }[] };

  // Události mimo období, na které odkazují vrácení (kdy byla původní změna).
  const byId = new Map(events.map((e) => [e.id, e]));
  const missing = [...new Set(events.map((e) => e.reverts_id).filter((x): x is number => x != null && !byId.has(x)))];
  const flagEvents = [...new Set(flagRows.map((f) => f.event_id).filter((x): x is number => x != null && !byId.has(x)))];
  const { data: extra } = missing.length || flagEvents.length
    ? await supabase.from('stock_events').select('id, kind, created_at, undo, undone_at, items').in('id', [...missing, ...flagEvents].slice(0, 500))
    : { data: [] };
  const extraById = new Map(((extra ?? []) as Pick<Ev, 'id' | 'kind' | 'created_at' | 'undo' | 'undone_at' | 'items'>[]).map((e) => [e.id, e]));

  const cardIds: string[] = [];
  for (const e of events) for (const it of (e.items ?? []).slice(0, e.items && e.items.length === 1 ? 1 : 3)) if (it.c) cardIds.push(it.c);
  for (const o of ords) for (const it of o.order_items.slice(0, 3)) if (it.card_id) cardIds.push(it.card_id);
  for (const f of flagRows) if (f.card_id) cardIds.push(f.card_id);
  const actors = [...new Set([...events.flatMap((e) => [e.actor_id, e.undone_by]), ...((invs ?? []) as Inv[]).map((i) => i.user_id),
    ...flagRows.flatMap((f) => [f.actor_id, f.resolved_by])].filter(Boolean) as string[])];
  const [cards, { data: profs }] = await Promise.all([
    loadCards(supabase, cardIds),
    actors.length ? supabase.from('profiles').select('id, display_name').in('id', actors) : Promise.resolve({ data: [] }),
  ]);
  const name = new Map(((profs ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const flagged = new Set(flagRows.filter((f) => !f.resolved_at && f.event_id).map((f) => f.event_id!));
  const invEvents = new Set(events.map((e) => /^Inventura č\. (\d+)/.exec(e.detail ?? '')?.[1]).filter(Boolean));

  const entries: HEntry[] = events.map((e) => {
    const items = e.items ?? [];
    const multi = items.length;
    const stored = e.title.replace(/^Vráceno: /, '');
    const isInv = /^Inventura /.test(stored) && e.kind === 'stock';
    const kind: HKind = e.kind === 'price' ? 'price' : isInv ? 'inv' : e.kind === 'sync' ? 'sync' : 'stock';
    let title = stored, icon: HIcon = kind === 'price' ? 'price' : kind === 'inv' ? 'inv' : kind === 'sync' ? 'sync' : 'stock', detail = e.detail;
    if (multi === 1 && !isInv) {
      const c = items[0].c ? cards.get(items[0].c) : null;
      const d = describe(e.kind, items[0], c?.name ?? stored, stored);
      title = d.title; icon = d.icon;
      if (d.detail) detail = d.detail + (e.detail ? ` · ${e.detail}` : '');
      else if (!detail) {
        const loc = items[0].loc1 || items[0].loc0;
        detail = [e.actor_id ? 'Ručně' : 'Automaticky', loc].filter(Boolean).join(' · ');
      }
    } else if (multi > 1 && !detail) {
      if (e.kind === 'price') {
        const up = items.filter((x) => x.p0 != null && x.p1 != null && x.p1 > x.p0).length;
        const dn = items.filter((x) => x.p0 != null && x.p1 != null && x.p1 < x.p0).length;
        detail = [up ? `${up} zdraženo` : '', dn ? `${dn} zlevněno` : ''].filter(Boolean).join(' · ') || null;
      } else detail = plural(multi, ['karta', 'karty', 'karet']);
    }
    if (e.reverts_id) { title = `Vráceno: ${title}`; icon = 'undo'; }
    const orig = e.reverts_id ? byId.get(e.reverts_id) ?? extraById.get(e.reverts_id) : null;
    const thumbs = items.slice(0, multi === 1 ? 1 : 3).map((x) => (x.c ? cards.get(x.c)?.image : null)).filter(Boolean) as string[];
    const places = [...new Set(items.flatMap((x) => [x.loc0, x.loc1]).filter(Boolean) as string[])];
    const searchNames = items.slice(0, 3).map((x) => (x.c ? cards.get(x.c)?.name ?? '' : ''));
    const impact = e.impact_czk && e.impact_czk !== 0 ? e.impact_czk : null;
    return {
      key: `e${e.id}`, kind, icon, title, detail, at: e.created_at,
      who: e.actor_id ? name.get(e.actor_id) ?? 'Člen týmu' : null, auto: e.actor_id ? null : 'Automaticky',
      eventId: e.id, canUndo: e.undo != null && !e.undone_at, undoneAt: e.undone_at, undoneBy: e.undone_by ? name.get(e.undone_by) ?? null : null,
      revertsId: e.reverts_id, revertsAt: orig?.created_at ?? null,
      impact, arrow: kind === 'price' || (impact != null && impact < 0) || e.reverts_id != null || kind === 'inv',
      thumbs, multi, listing: multi === 1 ? items[0].l : null, places,
      plus: items.reduce((s, x) => s + Math.max(0, x.q1 - x.q0), 0), minus: items.reduce((s, x) => s + Math.max(0, x.q0 - x.q1), 0),
      hromadne: multi > 1 && !isInv, flagged: flagged.has(e.id), href: null,
      search: fold([title, detail, ...searchNames].filter(Boolean).join(' ')),
    };
  });

  for (const o of ords) {
    const pcs = o.order_items.reduce((s, i) => s + i.quantity, 0);
    const value = o.order_items.reduce((s, i) => s + i.quantity * i.price_czk, 0) || o.total_czk - (o.shipping_czk ?? 0);
    const one = o.order_items.length === 1 ? o.order_items[0] : null;
    const c = one?.card_id ? cards.get(one.card_id) : null;
    const title = one && c ? `Prodáno ${one.quantity}× ${c.name}` : `Prodej · ${plural(pcs, ['kus', 'kusy', 'kusů'])}`;
    entries.push({
      key: `o${o.id}`, kind: 'sale', icon: 'sale', title, detail: `Objednávka č. ${o.number}`, at: o.decided_at ?? o.created_at,
      who: null, auto: 'Automaticky', eventId: null, canUndo: false, undoneAt: null, undoneBy: null, revertsId: null, revertsAt: null,
      impact: value, arrow: true,
      thumbs: o.order_items.slice(0, one ? 1 : 3).map((i) => (i.card_id ? cards.get(i.card_id)?.image : null)).filter(Boolean) as string[],
      multi: o.order_items.length, listing: one?.listing_id ?? null, places: [], plus: 0, minus: pcs, hromadne: false, flagged: false,
      href: `/objednavky/${o.number}`, search: fold(`${title} objednávka ${o.number}`),
    });
  }

  for (const i of (invs ?? []) as Inv[]) {
    if (!i.finished_at || invEvents.has(String(i.id))) continue;
    const lines = i.lines ?? [];
    const diff = lines.filter((l) => l.counted != null && l.counted !== l.expected).length;
    const title = `Inventura ${i.place}: ${plural(lines.length, ['karta', 'karty', 'karet'])}`;
    entries.push({
      key: `i${i.id}`, kind: 'inv', icon: 'inv', title,
      detail: i.status === 'review' ? 'Čeká na schválení rozdílu' : diff ? `${plural(diff, ['rozdíl', 'rozdíly', 'rozdílů'])} · ${lines.length - diff} sedí` : 'Vše sedí',
      at: i.finished_at, who: i.user_id ? name.get(i.user_id) ?? null : null, auto: null, eventId: null, canUndo: false, undoneAt: null, undoneBy: null,
      revertsId: null, revertsAt: null, impact: null, arrow: true, thumbs: [], multi: lines.length, listing: null, places: [i.place], plus: 0, minus: 0,
      hromadne: false, flagged: false, href: '/prodat?zalozka=inventura&pohled=historie', search: fold(title),
    });
  }
  entries.sort((a, b) => b.at.localeCompare(a.at));

  const flags: HFlag[] = flagRows.map((f) => {
    const ev = f.event_id ? byId.get(f.event_id) ?? extraById.get(f.event_id) : null;
    const items = (ev?.items ?? []) as Item[];
    const card = f.card_id ? cards.get(f.card_id) : null;
    const undoable = !!ev && ev.undo != null && !ev.undone_at;
    return {
      id: f.id, eventId: f.event_id, rule: f.rule, title: f.title, tag: f.tag, detail: f.detail, impact: f.impact_czk,
      who: f.actor_id ? name.get(f.actor_id) ?? 'Člen týmu' : null, at: f.at, thumb: card?.image ?? null,
      listing: items.length === 1 ? items[0].l : null,
      resolvedAt: f.resolved_at, resolvedBy: f.resolved_by ? name.get(f.resolved_by) ?? null : null, resolution: f.resolution, note: f.note,
      undoLabel: undoable ? (ev!.kind === 'price' ? 'Vrátit cenu' : 'Vrátit kusy') : null,
    };
  });

  return { entries, flags, rules: (rulesR.data as WatchRules | null) ?? null, hoursText, lead: leadR.data === true, period };
}
