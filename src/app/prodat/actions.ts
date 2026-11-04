'use server';

import { revalidatePath } from 'next/cache';
import { refreshCatalog } from '@/lib/catalog-refresh';
import { createClient } from '@/lib/supabase/server';
import { plural } from '@/lib/format';
import { CONDITIONS, LANGUAGE_NAMES } from '@/lib/types';
import { scheduleWatchFlush } from '@/lib/watch';

export interface ListingState {
  error?: string;
  ok?: boolean;
}

export async function createListing(_prev: ListingState, form: FormData): Promise<ListingState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Pro vystavení se nejdřív přihlaste.' };

  const cardId = String(form.get('card') ?? '');
  const condition = String(form.get('condition') ?? '');
  const language = String(form.get('language') ?? '');
  // Jen do skladu/sbírky: kusy mimo prodej, cena nepovinná, doprava a platba nejsou potřeba.
  const keep = form.get('mode') === 'keep';
  const rawPrice = String(form.get('price') ?? '').trim();
  const negotiable = form.get('negotiable') != null || (keep && !rawPrice);
  const price = negotiable ? null : Number(rawPrice);
  const quantity = Number(form.get('quantity'));
  const graded = String(form.get('graded') ?? '').trim();
  const note = String(form.get('note') ?? '').trim();

  if (!cardId) return { error: 'Vyberte kartu.' };
  if (!CONDITIONS.includes(condition as never)) return { error: 'Vyberte stav karty.' };
  if (!(language in LANGUAGE_NAMES)) return { error: 'Vyberte jazyk.' };
  if (price != null && (!Number.isInteger(price) || price <= 0)) return { error: 'Cena musí být celé číslo v korunách.' };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return { error: 'Počet kusů musí být 1 až 999.' };

  // Člověk z týmu přidává do skladu obchodu: jen mimo prodej, přes databázovou funkci s kontrolou práva.
  const owner = String(form.get('owner') ?? '');
  if (owner && owner !== auth.user.id) {
    if (!UUID.test(owner)) return { error: 'Obchod nenalezen.' };
    const { error: e } = await supabase.rpc('stock_add_for', {
      p_owner: owner, p_card: cardId, p_condition: condition, p_language: language, p_price: price, p_keep: quantity, p_note: note || null,
    });
    if (e) return { error: e.code === '42501' ? 'Na přidávání karet do tohoto skladu nemáte právo.' : 'Kartu se nepodařilo uložit. Zkuste to prosím znovu.' };
    revalidatePath('/prodat');
    return { ok: true };
  }

  const { data: row, error } = await supabase.from('listings').insert({
    card_id: cardId,
    seller_id: auth.user.id,
    price_czk: price,
    ...(negotiable ? { negotiable: true } : {}),
    condition,
    language,
    quantity: keep ? 0 : quantity,
    graded: graded || null,
    note: note || null,
  }).select('id').single();
  // 42501: databáze nepustí vystavení bez dopravy a platby (seller_ready).
  if (error?.code === '42501') return { error: 'Nejdřív doplňte dopravu a platbu v nastavení účtu.' };
  if (error && negotiable && error.code === 'PGRST204') return { error: 'Cena dohodou zatím nejde, zadejte prosím cenu.' };
  if (error || !row) return { error: 'Nabídku se nepodařilo uložit. Zkuste to prosím znovu.' };
  if (keep) await supabase.rpc('stock_set_keep', { p_rows: [{ id: row.id, keep: quantity, source: 'manual' }] });

  revalidatePath('/prodat');
  refreshCatalog();
  await scheduleWatchFlush();
  return { ok: true };
}

function revalidateStock() {
  revalidatePath('/prodat');
  refreshCatalog();
  revalidatePath('/prodejci', 'layout');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanIds = (ids: unknown) => (Array.isArray(ids) ? ids.map(String).filter((id) => UUID.test(id)).slice(0, 5000) : []);

export interface BulkResult {
  count?: number;
  error?: string;
}

export type StockOp = 'pct' | 'price' | 'negotiable' | 'sell' | 'unsell' | 'trade_all' | 'trade_none' | 'location' | 'remove';

const karet = (n: number) => plural(n, ['karta', 'karty', 'karet']);

function opTitle(op: StockOp, n: number, num?: number, text?: string): string {
  switch (op) {
    case 'pct': return `Cena ${num! > 0 ? '+' : '−'}${Math.abs(num!)} % · ${karet(n)}`;
    case 'price': return `Cena ${num} Kč · ${karet(n)}`;
    case 'negotiable': return `Cena dohodou · ${karet(n)}`;
    case 'sell': return `Na prodej · ${karet(n)}`;
    case 'unsell': return `Staženo z prodeje · ${karet(n)}`;
    case 'trade_all': return `Na výměnu · ${karet(n)}`;
    case 'trade_none': return `Zrušena výměna · ${karet(n)}`;
    case 'location': return text ? `Umístění ${text} · ${karet(n)}` : `Bez umístění · ${karet(n)}`;
    case 'remove': return `Odebráno ze skladu · ${karet(n)}`;
  }
}

function dbError(error: { code?: string; message?: string }) {
  if (error.code === '42501' && error.message?.includes('nemáte právo')) return 'Na tuto změnu nemáte právo.';
  if (error.code === '42501') return 'Prodávat jde až s dopravou a platbou. Doplňte je v nastavení účtu.';
  return 'Změnu se nepodařilo uložit. Zkuste to prosím znovu.';
}

// Hromadná změna skladu. Databázová funkce běží s právy přihlášeného, cizí řádky nezmění, a změnu zapíše do Historie.
export async function stockChange(ids: string[], op: StockOp, value?: number | string): Promise<BulkResult> {
  const list = cleanIds(ids);
  if (!list.length) return { error: 'Vyberte karty.' };
  const num = typeof value === 'number' ? value : undefined;
  const text = typeof value === 'string' ? value.trim().slice(0, 60) : undefined;
  if (op === 'pct' && (num == null || !Number.isFinite(num) || num <= -100 || num > 1000 || num === 0)) return { error: 'Změna ceny musí být mezi -99 a 1000 %.' };
  if (op === 'price' && (num == null || !Number.isInteger(num) || num <= 0)) return { error: 'Cena musí být celé číslo v korunách.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('stock_change', {
    p_ids: list, p_op: op, p_title: opTitle(op, list.length, num, text), p_num: num ?? null, p_text: text ?? null,
  });
  if (error) return { error: dbError(error) };
  revalidateStock();
  if (op === 'sell' || op === 'price' || op === 'pct') await scheduleWatchFlush();
  return { count: Number(data ?? 0) };
}

export interface StockSet {
  quantity: number;
  keep: number;
  trade: number;
  /** null = cena dohodou (nebo bez ceny mimo prodej) */
  price: number | null;
  location?: string;
  buyPrice?: number | null;
}

const qtyOk = (n: number) => Number.isInteger(n) && n >= 0 && n <= 100000;

// Úprava jednoho řádku z detailu karty.
export async function stockSet(id: string, name: string, set: StockSet): Promise<BulkResult> {
  const [clean] = cleanIds([id]);
  if (!clean) return { error: 'Karta nenalezena.' };
  if (!qtyOk(set.quantity) || !qtyOk(set.keep) || !qtyOk(set.trade)) return { error: 'Počty kusů musí být celá čísla od 0.' };
  if (set.price != null && (!Number.isInteger(set.price) || set.price <= 0)) return { error: 'Cena musí být celé číslo v korunách.' };
  if (set.buyPrice != null && (!Number.isInteger(set.buyPrice) || set.buyPrice < 0)) return { error: 'Nákupní cena musí být celé číslo v korunách.' };
  const p: Record<string, unknown> = { quantity: set.quantity, keep_qty: set.keep, trade_qty: set.trade, price_czk: set.price };
  if (set.location !== undefined) p.location = set.location;
  if (set.buyPrice !== undefined) p.buy_price_czk = set.buyPrice;
  const supabase = await createClient();
  const { error } = await supabase.rpc('stock_change', {
    p_ids: [clean], p_op: 'set', p_title: `Upraveno: ${String(name).slice(0, 150)}`, p_set: p,
  });
  if (error) return { error: dbError(error) };
  revalidateStock();
  if (set.quantity > 0) await scheduleWatchFlush();
  return { count: 1 };
}

// Vrátit změnu z Historie.
export async function stockUndo(eventId: number): Promise<BulkResult> {
  if (!Number.isInteger(eventId) || eventId <= 0) return { error: 'Změna nenalezena.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('stock_undo', { p_event: eventId });
  if (error) return { error: dbError(error) };
  if (!data) return { error: 'Tuto změnu už vrátit nejde.' };
  revalidateStock();
  return { count: Number(data) };
}

// Hledám: karty, které sběratel shání.
export async function saveWant(cardId: string, maxPrice: number | null, minCondition: string): Promise<BulkResult> {
  const [clean] = cleanIds([cardId]);
  if (!clean) return { error: 'Vyberte kartu.' };
  if (!CONDITIONS.includes(minCondition as never)) return { error: 'Vyberte stav.' };
  if (maxPrice != null && (!Number.isInteger(maxPrice) || maxPrice <= 0)) return { error: 'Cena musí být celé číslo v korunách.' };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Nejdřív se přihlaste.' };
  const { data: had } = await supabase.from('stock_wants').select('card_id').eq('user_id', auth.user.id).eq('card_id', clean).maybeSingle();
  const { error } = had
    ? await supabase.from('stock_wants').update({ max_price_czk: maxPrice, min_condition: minCondition }).eq('user_id', auth.user.id).eq('card_id', clean)
    : await supabase.from('stock_wants').insert({ user_id: auth.user.id, card_id: clean, max_price_czk: maxPrice, min_condition: minCondition });
  if (error) return { error: 'Kartu se nepodařilo uložit. Zkuste to prosím znovu.' };
  revalidatePath('/prodat');
  return { count: 1 };
}

export async function removeWant(cardId: string): Promise<BulkResult> {
  const [clean] = cleanIds([cardId]);
  if (!clean) return { error: 'Karta nenalezena.' };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Nejdřív se přihlaste.' };
  const { error } = await supabase.from('stock_wants').delete().eq('user_id', auth.user.id).eq('card_id', clean);
  if (error) return { error: 'Kartu se nepodařilo odebrat. Zkuste to prosím znovu.' };
  revalidatePath('/prodat');
  return { count: 1 };
}
