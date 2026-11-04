'use server';

import { revalidatePath } from 'next/cache';
import { refreshCatalog } from '@/lib/catalog-refresh';
import { searchCards } from '@/lib/catalog';
import { thumbUrl } from '@/lib/images';
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

/** Hlídat ceny sady: všechny chybějící karty do Hlídaných karet (nejhorší stav), nebo hlídání zrušit. */
export async function watchSet(setId: string, cond: string | null): Promise<SkResult> {
  if (!UUID.test(setId)) return { error: 'Sada nenalezena.' };
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
    const { error } = await supabase.from('card_watches').upsert(ids.map((id) => ({ user_id: auth.user!.id, card_id: id, min_condition: cond })), { onConflict: 'user_id,card_id', ignoreDuplicates: true });
    if (error) return { error: 'Hlídání se nepodařilo zapnout.' };
  }
  revalidatePath('/prodat');
  revalidatePath('/ucet/hlidane');
  return { count: ids.length };
}
