'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function setOrderStatus(form: FormData) {
  const supabase = await createClient();
  // Kdo smí jaký stav nastavit, hlídá funkce set_order_status v databázi.
  await supabase.rpc('set_order_status', { target: String(form.get('id')), next_status: String(form.get('status')) });
  revalidatePath('/objednavky');
}

export async function addReview(form: FormData) {
  const supabase = await createClient();
  const rating = Number(form.get('rating'));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;
  const comment = String(form.get('comment') ?? '').trim().slice(0, 500);
  await supabase.from('reviews').insert({
    order_id: String(form.get('orderId')),
    seller_id: String(form.get('sellerId')),
    rating,
    comment: comment || null,
  });
  revalidatePath('/objednavky');
  revalidatePath('/karty', 'layout');
}
