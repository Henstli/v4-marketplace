'use server';

import { revalidatePath } from 'next/cache';
import { refreshCatalog } from '@/lib/catalog-refresh';
import { getGame } from '@/lib/games';
import { QUANTITY_MAX } from '@/lib/import/columns';
import type { CardLite } from '@/lib/import/rows';
import { createClient } from '@/lib/supabase/server';
import { CONDITIONS, LANGUAGE_NAMES } from '@/lib/types';
import { scheduleWatchFlush } from '@/lib/watch';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UnmatchedInput {
  line: number;
  reason: 'none' | 'multi' | 'data';
  game: string | null;
  name: string;
  setCode: string;
  setName: string;
  number: string;
  condition: string | null;
  language: string | null;
  rawCondition: string;
  rawLanguage: string;
  price: number | null;
  quantity: number | null;
  graded: string;
  note: string;
  candidates: CardLite[];
}

const cut = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n) || null;

/** Nahrání tabulky: řádky k opravě se uloží do Nespárovaných, prodejce je dořeší ve skladu. */
export async function saveUnmatched(rows: UnmatchedInput[], file: string): Promise<{ count?: number; error?: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Přihlášení vypršelo. Přihlaste se prosím znovu.' };
  const list = (Array.isArray(rows) ? rows : []).slice(0, 20000).map((r) => {
    const price = Number(r.price);
    const qty = Number(r.quantity);
    return {
      owner_id: auth.user!.id,
      file: cut(file, 160),
      line: Number.isInteger(r.line) ? r.line : null,
      reason: ['none', 'multi', 'data'].includes(r.reason) ? r.reason : 'none',
      game: r.game && getGame(r.game) ? r.game : null,
      name: cut(r.name, 160),
      set_code: cut(r.setCode, 40),
      set_name: cut(r.setName, 120),
      number: cut(r.number, 30),
      condition: CONDITIONS.includes(r.condition as never) ? r.condition : null,
      language: r.language && r.language in LANGUAGE_NAMES ? r.language : null,
      raw_condition: cut(r.rawCondition, 40),
      raw_language: cut(r.rawLanguage, 40),
      price_czk: Number.isInteger(price) && price > 0 ? price : null,
      quantity: Number.isInteger(qty) && qty >= 1 ? Math.min(qty, QUANTITY_MAX) : 1,
      graded: cut(r.graded, 20),
      note: cut(r.note, 200),
      candidates: (Array.isArray(r.candidates) ? r.candidates : []).filter((c) => UUID.test(String(c?.id))).slice(0, 6).map((c) => ({
        id: c.id, slug: cut(c.slug, 200), name: cut(c.name, 160), number: cut(c.number, 30), game: c.game,
        setCode: cut(c.setCode, 40), setName: cut(c.setName, 120), image: c.image ? String(c.image).slice(0, 500) : null,
      })),
    };
  });
  if (!list.length) return { count: 0 };
  let count = 0;
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await supabase.from('stock_unmatched').insert(list.slice(i, i + 500));
    if (error) return { count, error: 'Řádky k opravě se nepodařilo uložit do Nespárovaných.' };
    count += Math.min(500, list.length - i);
  }
  revalidatePath('/prodat');
  return { count };
}

/** Nespárované: vybraná karta přijde do skladu (s cenou na prodej, bez ceny mimo prodej). */
export async function resolveUnmatched(id: number, cardId: string, condition: string, language: string, quantity: number, price: number | null): Promise<{ ok?: boolean; sale?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Přihlášení vypršelo. Přihlaste se prosím znovu.' };
  if (!Number.isInteger(id) || !UUID.test(String(cardId))) return { error: 'Vyberte kartu.' };
  if (!CONDITIONS.includes(condition as never)) return { error: 'Vyberte stav.' };
  if (!(language in LANGUAGE_NAMES)) return { error: 'Vyberte jazyk.' };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > QUANTITY_MAX) return { error: `Počet kusů musí být 1 až ${QUANTITY_MAX}.` };
  if (price != null && (!Number.isInteger(price) || price <= 0)) return { error: 'Cena musí být celé číslo v korunách.' };
  const { data: row } = await supabase.from('stock_unmatched').select('id, graded, note').eq('id', id).maybeSingle();
  if (!row) return { error: 'Položka už v Nespárovaných není.' };

  const base = {
    card_id: cardId, seller_id: auth.user.id, condition, language, negotiable: price == null, price_czk: price,
    graded: row.graded, note: row.note,
  };
  // S cenou zkusíme rovnou na prodej; bez dopravy a platby (nebo bez ceny) jde karta do skladu mimo prodej.
  let sale = price != null;
  let ins = await supabase.from('listings').insert({ ...base, quantity: sale ? quantity : 0 }).select('id').single();
  if (ins.error && sale && ins.error.code === '42501') {
    sale = false;
    ins = await supabase.from('listings').insert({ ...base, quantity: 0 }).select('id').single();
  }
  if (ins.error || !ins.data) return { error: 'Kartu se nepodařilo uložit. Zkuste to prosím znovu.' };
  await supabase.rpc('stock_set_keep', { p_rows: [{ id: ins.data.id, keep: sale ? 0 : quantity, source: 'import' }] });
  await supabase.from('stock_unmatched').delete().eq('id', id);
  revalidatePath('/prodat');
  if (sale) { refreshCatalog(); await scheduleWatchFlush(); }
  return { ok: true, sale };
}

/** Ignorovat (zůstane jen v tabulce) nebo vrátit k párování. */
export async function ignoreUnmatched(ids: number[], on: boolean): Promise<{ error?: string }> {
  const list = (Array.isArray(ids) ? ids : []).filter(Number.isInteger).slice(0, 5000);
  if (!list.length) return {};
  const supabase = await createClient();
  const { error } = await supabase.from('stock_unmatched').update({ ignored_at: on ? new Date().toISOString() : null }).in('id', list);
  if (error) return { error: 'Změnu se nepodařilo uložit.' };
  revalidatePath('/prodat');
  return {};
}

/** Smazat položky z Nespárovaných (jen ignorované). */
export async function deleteUnmatched(ids: number[]): Promise<{ error?: string }> {
  const list = (Array.isArray(ids) ? ids : []).filter(Number.isInteger).slice(0, 5000);
  if (!list.length) return {};
  const supabase = await createClient();
  const { error } = await supabase.from('stock_unmatched').delete().in('id', list).not('ignored_at', 'is', null);
  if (error) return { error: 'Položky se nepodařilo smazat.' };
  revalidatePath('/prodat');
  return {};
}
