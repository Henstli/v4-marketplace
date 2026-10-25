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

export async function deleteListing(form: FormData) {
  const supabase = await createClient();
  // RLS pustí smazání jen vlastní nabídky.
  await supabase.from('listings').delete().eq('id', String(form.get('id')));
  revalidatePath('/prodat');
  revalidatePath('/karty', 'layout');
}
