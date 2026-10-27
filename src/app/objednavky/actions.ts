'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { siteOrigin } from '@/lib/auth-helpers';
import { sendOrderEmail } from '@/lib/email';
import { createClient } from '@/lib/supabase/server';
import { scheduleWatchFlush } from '@/lib/watch';

export async function setOrderStatus(form: FormData) {
  const supabase = await createClient();
  const id = String(form.get('id'));
  const op = String(form.get('op') ?? 'status');
  // Zaplaceno (kupující) a Nepřišla (prodejce) stav nemění, jen zapíšou platbu a napíšou do chatu.
  if (op === 'mark_paid' || op === 'not_received') {
    await supabase.rpc(op === 'mark_paid' ? 'mark_order_paid' : 'payment_not_received', { target: id });
    revalidatePath('/objednavky');
    revalidatePath('/', 'layout');
    return;
  }
  const status = String(form.get('status'));
  // Kdo smí jaký stav nastavit, hlídá funkce set_order_status v databázi.
  const { error } = await supabase.rpc('set_order_status', { target: id, next_status: status });
  const tracking = String(form.get('tracking') ?? '').trim();
  if (!error && status === 'shipped' && tracking) await supabase.rpc('set_order_tracking', { target: id, p_tracking: tracking });
  if (!error && (status === 'confirmed' || status === 'declined')) {
    const [user, origin] = await Promise.all([getCurrentUser(), siteOrigin()]);
    if (user) after(() => sendOrderEmail(supabase, id, status, user.displayName, origin));
  }
  // Odmítnutí a zrušení vrací kusy do nabídky, čekající na kartu dostanou e-mail.
  if (!error && (status === 'declined' || status === 'cancelled')) await scheduleWatchFlush();
  revalidatePath('/objednavky');
  revalidatePath('/', 'layout');
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
