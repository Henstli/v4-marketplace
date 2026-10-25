'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { CONDITIONS, LANGUAGE_NAMES } from '@/lib/types';

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
  const price = Number(form.get('price'));
  const quantity = Number(form.get('quantity'));
  const graded = String(form.get('graded') ?? '').trim();
  const note = String(form.get('note') ?? '').trim();

  if (!cardId) return { error: 'Vyberte kartu.' };
  if (!CONDITIONS.includes(condition as never)) return { error: 'Vyberte stav karty.' };
  if (!(language in LANGUAGE_NAMES)) return { error: 'Vyberte jazyk.' };
  if (!Number.isInteger(price) || price <= 0) return { error: 'Cena musí být celé číslo v korunách.' };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return { error: 'Počet kusů musí být 1 až 999.' };

  const { error } = await supabase.from('listings').insert({
    card_id: cardId,
    seller_id: auth.user.id,
    price_czk: price,
    condition,
    language,
    quantity,
    graded: graded || null,
    note: note || null,
  });
  if (error) return { error: 'Nabídku se nepodařilo uložit. Zkuste to prosím znovu.' };

  revalidatePath('/prodat');
  revalidatePath('/karty', 'layout');
  return { ok: true };
}

function revalidateStock() {
  revalidatePath('/prodat');
  revalidatePath('/karty', 'layout');
  revalidatePath('/prodejci', 'layout');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanIds = (ids: unknown) => (Array.isArray(ids) ? ids.map(String).filter((id) => UUID.test(id)).slice(0, 5000) : []);

export interface BulkChange {
  /** Změna ceny v procentech, např. -10 */
  pct?: number;
  /** Nová cena za kus v Kč */
  price?: number;
  /** Nový počet kusů */
  quantity?: number;
}

export interface BulkResult {
  count?: number;
  error?: string;
}

// Hromadná úprava vlastních nabídek. Databázová funkce běží s právy prodejce, cizí nabídky nezmění.
export async function bulkUpdateListings(ids: string[], change: BulkChange): Promise<BulkResult> {
  const list = cleanIds(ids);
  if (!list.length) return { error: 'Vyberte nabídky.' };
  const pct = change.pct == null ? null : Number(change.pct);
  const price = change.price == null ? null : Number(change.price);
  const quantity = change.quantity == null ? null : Number(change.quantity);
  if (pct != null && (!Number.isFinite(pct) || pct <= -100 || pct > 1000 || pct === 0)) return { error: 'Změna ceny musí být mezi -99 a 1000 %.' };
  if (price != null && (!Number.isInteger(price) || price <= 0)) return { error: 'Cena musí být celé číslo v korunách.' };
  if (quantity != null && (!Number.isInteger(quantity) || quantity < 0 || quantity > 999)) return { error: 'Počet kusů musí být 0 až 999.' };
  if (pct == null && price == null && quantity == null) return { error: 'Zadejte, co se má změnit.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('bulk_update_listings', {
    p_ids: list, p_price_pct: pct, p_price: price, p_quantity: quantity,
  });
  if (error) return { error: 'Nabídky se nepodařilo upravit. Zkuste to prosím znovu.' };
  revalidateStock();
  return { count: Number(data ?? 0) };
}

// Stažení z prodeje: nabídka bez objednávek se smaže, s objednávkou dostane 0 kusů.
export async function withdrawListings(ids: string[]): Promise<BulkResult> {
  const list = cleanIds(ids);
  if (!list.length) return { error: 'Vyberte nabídky.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('withdraw_listings', { p_ids: list });
  if (error) return { error: 'Nabídky se nepodařilo stáhnout. Zkuste to prosím znovu.' };
  revalidateStock();
  return { count: Number(data ?? 0) };
}
