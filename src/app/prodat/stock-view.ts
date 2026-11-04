import { getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { createClient } from '@/lib/supabase/browser';
import { mapRow, owned, type LoadRow, type StockRow } from './data';

/**
 * Tabulka skladu po stránkách: hledání, filtry, řazení a souhrny počítá databáze (stock_query, stock_summary),
 * do prohlížeče jde jen zobrazená stránka. Čtení jde z prohlížeče rovnou do databáze (ne přes Vercel),
 * práva hlídá databáze stejně jako dřív (majitel nebo tým s právem „view“).
 */

export type Item = {
  r: StockRow; id: string; key: string; name: string; set: string; game: string; gameId: string; img: string | null;
  cond: string; lang: string; have: number; sale: number; keep: number; trade: number; price: number | null; market: number | null;
  loc: string; src: string; listed: number; buy: number | null; locked: boolean; upd: string;
  /** Kusy, které drží album (0 nebo 1), a název alba */
  held: number; album: string | null;
};

export const SLOW = 60;
const days = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0);
export const toItem = (r: StockRow): Item => ({
  r, id: r.id, key: r.cardId, name: r.card?.name ?? 'Karta', set: `${r.card?.setCode ?? ''} ${r.card?.number ?? ''}`.trim(),
  game: getGame(r.card?.game ?? '')?.name ?? '', gameId: r.card?.game ?? '', img: thumbUrl(r.card?.image ?? undefined) ?? null,
  cond: r.condition, lang: r.language, have: owned(r), sale: r.quantity, keep: r.keep, trade: Math.min(r.trade, owned(r)),
  price: r.price, market: r.market, loc: r.location ?? '', src: r.source, listed: r.quantity > 0 ? days(r.listedAt) : 0,
  buy: r.buyPrice, locked: r.removed || r.hidden != null, upd: r.updatedAt,
  held: r.album ? 1 : 0, album: r.album ?? null,
});
export const fromLoad = (rows: unknown) => ((rows ?? []) as LoadRow[]).map((l) => toItem(mapRow(l)));

/** Souhrny celého skladu (pruh, upozornění, nabídky filtrů, počty v záložkách) z funkce stock_summary. */
export interface StockSummary {
  total: number; pcs: number; kinds: number; onSale: number; val: number; offer: number; oldN: number; dups: number; tradeN: number;
  attn: { n: number; noPrice: number; mkt: number; noLoc: number; old: number } | null;
  games: string[]; langs: string[]; srcs: string[];
  locg: Record<string, number>; locf: Record<string, number>;
  kindsAll: number; kindsSale: number; owned: number; rows: number; places: string[]; gameIds: string[];
}
export const EMPTY_SUMMARY: StockSummary = {
  total: 0, pcs: 0, kinds: 0, onSale: 0, val: 0, offer: 0, oldN: 0, dups: 0, tradeN: 0, attn: null, games: [], langs: [], srcs: [],
  locg: {}, locf: {}, kindsAll: 0, kindsSale: 0, owned: 0, rows: 0, places: [], gameIds: [],
};

/** Jedna stránka tabulky ze stock_query. */
export interface StockPage { page: number; nGroups: number; nRows: number; nIds: number; items: Item[] }
export type StockPageRaw = { page: number; nGroups: number; nRows: number; nIds: number; rows: LoadRow[] };
export const toPage = (d: StockPageRaw | null): StockPage => ({
  page: d?.page ?? 1, nGroups: d?.nGroups ?? 0, nRows: d?.nRows ?? 0, nIds: d?.nIds ?? 0, items: fromLoad(d?.rows),
});

/** Filtr a řazení tabulky tak, jak je chápe stock_query. */
export interface StockParams {
  mode: 'all' | 'sale'; shop: boolean; q: string; g: string[]; c: string[]; l: string[]; s: string[]; p: string[];
  forSale: '' | 'on' | 'off'; attn: boolean; dup: boolean; old: boolean; sort: 'chg' | 'name' | 'cond' | 'lang' | 'have' | 'sale' | 'price' | 'loc'; dir?: 'asc' | 'desc';
  page: number; size: number; more: number; fz?: Record<string, string | number>;
}

let sb: ReturnType<typeof createClient> | null = null;
const db = () => (sb ??= createClient());
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchPage = async (owner: string, p: StockParams) => toPage(await rpc<StockPageRaw | null>('stock_query', { p_owner: owner, p }));
export const fetchIds = async (owner: string, p: StockParams) =>
  (await rpc<{ ids: string[] } | null>('stock_query', { p_owner: owner, p: { ...p, what: 'ids' } }))?.ids ?? [];
export const fetchAll = async (owner: string, p: StockParams) =>
  fromLoad((await rpc<{ rows: LoadRow[] } | null>('stock_query', { p_owner: owner, p: { ...p, what: 'full' } }))?.rows);
export const fetchCard = async (owner: string, cardId: string) => fromLoad(await rpc<LoadRow[] | null>('stock_rows', { p_owner: owner, p_ids: [], p_card: cardId }));
export const fetchSummary = async (owner: string, mode: 'all' | 'sale', shop: boolean) =>
  (await rpc<StockSummary | null>('stock_summary', { p_owner: owner, p_mode: mode, p_shop: shop })) ?? EMPTY_SUMMARY;

/** Součty karty po úpravě: [kusů, řádků v tabulce, řádků s kusy, řádků s kusy na prodej]. */
type CardTot = [number, number, number, number];
export async function fetchPatch(owner: string, ids: string[], cards: string[]) {
  const d = await rpc<{ rows: LoadRow[]; cards: Record<string, CardTot> } | null>('stock_patch', { p_owner: owner, p_ids: ids, p_cards: cards });
  return { items: fromLoad(d?.rows), cards: d?.cards ?? {} };
}

const isMkt = (i: Item) => i.price != null && !!i.market && Math.abs(i.price / i.market - 1) >= 0.15;
const isOld = (i: Item) => i.sale > 0 && i.listed >= SLOW;
const add = (o: Record<string, number>, k: string, n: number) => { const v = (o[k] ?? 0) + n; if (v > 0) o[k] = v; else delete o[k]; };

/**
 * Souhrny po úpravě bez načítání celého skladu: odečtou se upravené řádky před změnou a přičtou po ní.
 * Počty druhů a duplicit se dopočítají ze součtů dotčených karet.
 */
export function applyDelta(s: StockSummary, before: Item[], after: Item[], cards: Record<string, CardTot>, mode: 'all' | 'sale', shop: boolean): StockSummary {
  const n: StockSummary = { ...s, locg: { ...s.locg }, locf: { ...s.locf }, attn: s.attn ? { ...s.attn } : null,
    games: [...s.games], langs: [...s.langs], srcs: [...s.srcs], places: [...s.places], gameIds: [...s.gameIds] };
  const apply = (i: Item, k: 1 | -1) => {
    n.total += k; n.pcs += k * i.have; n.onSale += k * i.sale;
    n.val += k * i.have * (i.market ?? i.price ?? 0); n.offer += k * i.sale * (i.price ?? i.market ?? 0);
    if (isOld(i)) n.oldN += k;
    if (i.trade > 0) n.tradeN += k;
    if (n.attn && shop) {
      const np = i.sale > 0 && i.price == null, mk = isMkt(i), nl = !i.loc, ol = isOld(i);
      if (np || mk || nl || ol) n.attn.n += k;
      if (np) n.attn.noPrice += k;
      if (mk) n.attn.mkt += k;
      if (nl) n.attn.noLoc += k;
      if (ol) n.attn.old += k;
    }
    if (mode !== 'sale' || i.sale > 0) {
      if (!i.loc) add(n.locg, '—', k * i.have);
      else { add(n.locg, i.loc.split(' · ')[0], k * i.have); add(n.locf, i.loc, k * i.have); }
    }
    if (i.have > 0) n.owned += k;
  };
  before.forEach((i) => apply(i, -1));
  after.forEach((i) => {
    apply(i, 1);
    if (mode !== 'sale' || i.sale > 0) {
      if (i.gameId && !n.games.includes(i.gameId)) n.games.push(i.gameId);
      if (!n.langs.includes(i.lang)) n.langs.push(i.lang);
      if (!n.srcs.includes(i.src)) n.srcs.push(i.src);
    }
    const pl = i.loc.split(' · ')[0];
    if (pl && !n.places.includes(pl)) n.places.push(pl);
  });
  // Druhy a duplicity: součty karty teď a před úpravou (teď minus změna upravených řádků).
  const keys = new Set([...before.map((i) => i.key), ...after.map((i) => i.key)]);
  for (const c of keys) {
    const [have, rows, rowsHave, rowsSale] = cards[c] ?? [0, 0, 0, 0];
    const b = before.filter((i) => i.key === c), a = after.filter((i) => i.key === c);
    const sum = (l: Item[], f: (i: Item) => number) => l.reduce((t, i) => t + f(i), 0);
    const haveB = have - sum(a, (i) => i.have) + sum(b, (i) => i.have);
    const rowsB = rows - a.length + b.length;
    const rowsHaveB = rowsHave - a.filter((i) => i.have > 0).length + b.filter((i) => i.have > 0).length;
    const rowsSaleB = rowsSale - a.filter((i) => i.have > 0 && i.sale > 0).length + b.filter((i) => i.have > 0 && i.sale > 0).length;
    n.kinds += +(rows > 0) - +(rowsB > 0);
    n.dups += +(have > 1) - +(haveB > 1);
    n.kindsAll += +(rowsHave > 0) - +(rowsHaveB > 0);
    n.kindsSale += +(rowsSale > 0) - +(rowsSaleB > 0);
  }
  return n;
}

/**
 * Počty v záložkách (Všechny karty / Na prodej) se po úpravě v tabulce obnoví bez načtení celé stránky.
 * id = majitel + počty ze serveru: po novém vykreslení stránky platí zase čísla ze serveru.
 */
type Counts = { id: string; vse: number; prodej: number };
export const countsId = (owner: string, s: Pick<StockSummary, 'kindsAll' | 'kindsSale'>) => `${owner}:${s.kindsAll}:${s.kindsSale}`;
let counts: Counts | null = null;
const subs = new Set<() => void>();
export const liveCounts = {
  get: () => counts,
  set: (c: Counts) => { counts = c; subs.forEach((f) => f()); },
  sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
};
