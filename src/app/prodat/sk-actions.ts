'use server';

import { revalidatePath } from 'next/cache';
import { refreshCatalog } from '@/lib/catalog-refresh';
import { searchCards } from '@/lib/catalog';
import { thumbUrl } from '@/lib/images';
import { compareCardNumbers } from '@/lib/album/designs';
import { getGame } from '@/lib/games';
import { createClient } from '@/lib/supabase/server';
import { CONDITIONS } from '@/lib/types';
import { scheduleWatchFlush } from '@/lib/watch';
import { CARD_LANGS } from './sk';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SkResult { count?: number; error?: string }

function dbError(error: { code?: string; message?: string }) {
  if (error.code === '42501' && error.message?.includes('nemáte právo')) return 'Na tuto změnu nemáte právo.';
  if (error.code === '42501' && error.message?.includes('dvoufázové')) return 'Dokončete dvoufázové ověření.';
  if (error.code === '42501') return 'Prodávat jde až s dopravou a platbou. Doplňte je v nastavení účtu.';
  return 'Změnu se nepodařilo uložit. Zkuste to prosím znovu.';
}

export interface BulkRow { id: string; quantity?: number; keep_qty?: number; price_czk?: number | null; condition?: string; language?: string }

/** Hromadné nastavení řádků skladu jednou změnou v Historii (jde vrátit). quiet: z tabulky skladu, ta si řádky obnoví sama. */
export async function stockBulkSet(rows: BulkRow[], title: string, kind: 'stock' | 'price' = 'stock', quiet = false): Promise<SkResult> {
  const clean = (Array.isArray(rows) ? rows : []).filter((r) => UUID.test(String(r.id))).slice(0, 5000).map((r) => {
    const o: BulkRow = { id: String(r.id) };
    if (r.quantity !== undefined) { if (!Number.isInteger(r.quantity) || r.quantity < 0) throw new Error('qty'); o.quantity = r.quantity; }
    if (r.keep_qty !== undefined) { if (!Number.isInteger(r.keep_qty) || r.keep_qty < 0) throw new Error('keep'); o.keep_qty = r.keep_qty; }
    if (r.price_czk !== undefined) o.price_czk = r.price_czk == null ? null : Math.max(1, Math.round(Number(r.price_czk)));
    if (r.condition !== undefined && CONDITIONS.includes(r.condition as never)) o.condition = r.condition;
    if (r.language !== undefined && CARD_LANGS.includes(r.language)) o.language = r.language;
    return o;
  });
  if (!clean.length) return { error: 'Vyberte karty.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('stock_bulk_set', { p_rows: clean, p_title: String(title).slice(0, 200), p_kind: kind });
  if (error) return { error: dbError(error) };
  if (quiet !== true) revalidatePath('/prodat');
  // Jen kusy mimo prodej: veřejný katalog se nemění, nemusí se přegenerovat.
  if (clean.some((r) => r.quantity !== undefined || r.price_czk !== undefined || r.condition !== undefined || r.language !== undefined)) {
    refreshCatalog();
    revalidatePath('/prodejci', 'layout');
  }
  if (clean.some((r) => r.quantity || r.price_czk)) await scheduleWatchFlush();
  return { count: Number(data ?? 0) };
}

export interface CardInfo { events: { id: number; at: string; title: string }[]; series: number[]; change: number | null }

/** Detail karty: historie řádku a vývoj tržní ceny za 30 dní. */
export async function cardInfo(listingId: string, cardId: string): Promise<CardInfo> {
  if (!UUID.test(listingId) || !UUID.test(cardId)) return { events: [], series: [], change: null };
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [{ data: ev }, { data: ph }] = await Promise.all([
    supabase.rpc('stock_row_events', { p_listing: listingId }),
    supabase.from('price_history').select('day, avg_price_czk').eq('card_id', cardId).gte('day', since).order('day'),
  ]);
  const series = ((ph ?? []) as { avg_price_czk: number }[]).map((p) => p.avg_price_czk);
  const change = series.length > 1 && series[0] ? Math.round((series[series.length - 1] / series[0] - 1) * 100) : null;
  return {
    events: ((ev ?? []) as { id: number; created_at: string; title: string }[]).map((e) => ({ id: e.id, at: e.created_at, title: e.title })),
    series, change,
  };
}

export interface FoundCard { id: string; name: string; set: string; game: string; image: string | null }

/** Okno Přidat karty: hledání v katalogu. */
export async function addSearch(q: string): Promise<FoundCard[]> {
  const t = String(q ?? '').trim().slice(0, 80);
  if (t.length < 2) return [];
  const found = await searchCards({ q: t, pageSize: 6 });
  return found.cards.map((c) => ({
    id: c.id, name: c.name, set: `${c.setCode} ${c.number}`.trim(), game: getGame(c.game)?.name ?? '', image: thumbUrl(c.image) ?? null,
  }));
}

/** Okno Přidat karty: hromádka do skladu nebo sbírky (mimo prodej, bez ceny). */
export async function addPile(owner: string, pile: { cardId: string; n: number; cond: string; lang: string }[]): Promise<SkResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Nejdřív se přihlaste.' };
  const list = (Array.isArray(pile) ? pile : []).filter((p) => UUID.test(p.cardId) && Number.isInteger(p.n) && p.n >= 1 && p.n <= 999
    && CONDITIONS.includes(p.cond as never) && CARD_LANGS.includes(p.lang)).slice(0, 200);
  if (!list.length) return { error: 'Hromádka je prázdná.' };
  let pcs = 0;
  if (owner && owner !== auth.user.id) {
    if (!UUID.test(owner)) return { error: 'Obchod nenalezen.' };
    for (const p of list) {
      const { error } = await supabase.rpc('stock_add_for', {
        p_owner: owner, p_card: p.cardId, p_condition: p.cond, p_language: p.lang, p_price: null, p_keep: p.n, p_note: null,
      });
      if (error) return { error: error.code === '42501' ? 'Na přidávání karet do tohoto skladu nemáte právo.' : 'Karty se nepodařilo uložit. Zkuste to prosím znovu.' };
      pcs += p.n;
    }
  } else {
    const { data, error } = await supabase.from('listings').insert(list.map((p) => ({
      card_id: p.cardId, seller_id: auth.user!.id, price_czk: null, negotiable: true, condition: p.cond, language: p.lang, quantity: 0,
    }))).select('id');
    if (error || !data) return { error: 'Karty se nepodařilo uložit. Zkuste to prosím znovu.' };
    const { error: e2 } = await supabase.rpc('stock_set_keep', { p_rows: data.map((r, i) => ({ id: r.id, keep: list[i].n, source: 'manual' })) });
    if (e2) return { error: 'Karty se nepodařilo uložit. Zkuste to prosím znovu.' };
    pcs = list.reduce((s, p) => s + p.n, 0);
  }
  revalidatePath('/prodat');
  return { count: pcs };
}

export interface MissingCard { id: string; slug: string; name: string; number: string; image: string | null; low: number | null; offers: number }

/** Chybí do sady: chybějící karty od nejlevnější nabídky. */
export async function setMissing(setId: string): Promise<MissingCard[]> {
  if (!UUID.test(setId)) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc('stock_set_missing', { p_set: setId });
  return ((data ?? []) as { card_id: string; slug: string; name: string; number: string; image_url: string | null; low_czk: number | null; offers: number }[])
    .map((c) => ({ id: c.card_id, slug: c.slug, name: c.name, number: c.number, image: thumbUrl(c.image_url ?? undefined) ?? null, low: c.low_czk, offers: c.offers }));
}

/** Hlídat ceny sady: všechny chybějící karty do Hlídaných karet (nejhorší stav, nejvyšší cena, konec po získání), nebo hlídání zrušit. */
export async function watchSet(setId: string, cond: string | null, maxPrice: number | null = null, stopOnHave = true): Promise<SkResult> {
  if (!UUID.test(setId)) return { error: 'Sada nenalezena.' };
  if (maxPrice != null && (!Number.isInteger(maxPrice) || maxPrice <= 0)) return { error: 'Cena musí být celé číslo v korunách.' };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Nejdřív se přihlaste.' };
  const { data } = await supabase.rpc('stock_set_missing', { p_set: setId });
  const ids = ((data ?? []) as { card_id: string }[]).map((c) => c.card_id);
  if (!ids.length) return { count: 0 };
  if (cond == null) {
    const { error } = await supabase.from('card_watches').delete().eq('user_id', auth.user.id).in('card_id', ids);
    if (error) return { error: 'Hlídání se nepodařilo zrušit.' };
  } else {
    if (!CONDITIONS.includes(cond as never)) return { error: 'Vyberte stav.' };
    const { error } = await supabase.from('card_watches').upsert(
      ids.map((id) => ({ user_id: auth.user!.id, card_id: id, min_condition: cond, max_price_czk: maxPrice, stop_on_have: stopOnHave })),
      { onConflict: 'user_id,card_id' });
    if (error) return { error: 'Hlídání se nepodařilo zapnout.' };
  }
  revalidatePath('/prodat');
  revalidatePath('/ucet/hlidane');
  return { count: ids.length };
}

export interface SetViewCard {
  id: string; slug: string; name: string; number: string; image: string | null;
  /** Kusů ve sbírce, z toho mimo prodej a na prodeji */
  have: number; keep: number; sale: number;
  /** Nejnižší nabídka na V4cards a počet nabídek */
  low: number | null; offers: number;
  watched: boolean;
}
export interface SetView {
  cards: SetViewCard[];
  /** Nastavení hlídání chybějících karet (z první hlídané) */
  watch: { cond: string; max: number | null; stop: boolean } | null;
  album: { id: string; name: string } | null;
}

/** Okno sady (Chybí do sad): karty sady se sbírkou a cenami, hlídání a album. */
export async function setView(setId: string): Promise<SetView | null> {
  if (!UUID.test(setId)) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;
  const { data: cards } = await supabase.from('cards').select('id, slug, name, number, image_url').eq('set_id', setId).eq('hidden', false).limit(1000)
    .returns<{ id: string; slug: string; name: string; number: string; image_url: string | null }[]>();
  const list = (cards ?? []).sort((x, y) => compareCardNumbers(x.number, y.number));
  const ids = list.map((c) => c.id);
  const st = new Map<string, { keep: number; sale: number }>();
  const mk = new Map<string, { min: number | null; n: number }>();
  const w = new Map<string, { cond: string | null; max: number | null; stop: boolean }>();
  for (let i = 0; i < ids.length; i += 300) {
    const part = ids.slice(i, i + 300);
    const [a, b, c] = await Promise.all([
      supabase.from('listings').select('card_id, quantity, listing_stock(keep_qty)').eq('seller_id', uid).is('removed_at', null).in('card_id', part)
        .returns<{ card_id: string; quantity: number; listing_stock: { keep_qty: number } | null }[]>(),
      supabase.from('card_market').select('card_id, min_price, offers').in('card_id', part).returns<{ card_id: string; min_price: number | null; offers: number }[]>(),
      supabase.from('card_watches').select('card_id, min_condition, max_price_czk, stop_on_have').eq('user_id', uid).in('card_id', part)
        .returns<{ card_id: string; min_condition: string | null; max_price_czk: number | null; stop_on_have: boolean }[]>(),
    ]);
    for (const r of a.data ?? []) { const x = st.get(r.card_id) ?? { keep: 0, sale: 0 }; x.keep += r.listing_stock?.keep_qty ?? 0; x.sale += r.quantity; st.set(r.card_id, x); }
    for (const r of b.data ?? []) mk.set(r.card_id, { min: r.min_price, n: r.offers });
    for (const r of c.data ?? []) w.set(r.card_id, { cond: r.min_condition, max: r.max_price_czk, stop: r.stop_on_have });
  }
  const out = list.map((c) => {
    const x = st.get(c.id) ?? { keep: 0, sale: 0 };
    return { id: c.id, slug: c.slug, name: c.name, number: c.number, image: thumbUrl(c.image_url ?? undefined) ?? null,
      have: x.keep + x.sale, keep: x.keep, sale: x.sale, low: mk.get(c.id)?.min ?? null, offers: mk.get(c.id)?.n ?? 0, watched: w.has(c.id) };
  });
  const firstW = out.find((c) => !c.have && w.has(c.id));
  const fw = firstW ? w.get(firstW.id)! : null;
  const { data: alb } = await supabase.from('collection_albums').select('id, name').eq('user_id', uid).eq('kind', 'set').eq('set_id', setId)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle<{ id: string; name: string }>();
  return { cards: out, watch: fw ? { cond: fw.cond ?? 'PL', max: fw.max, stop: fw.stop } : null, album: alb ?? null };
}
