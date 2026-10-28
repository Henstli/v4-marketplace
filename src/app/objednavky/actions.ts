'use server';

import { revalidatePath } from 'next/cache';
import { refreshCatalog } from '@/lib/catalog-refresh';
import { after } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { siteOrigin } from '@/lib/auth-helpers';
import { sendOrderEmail } from '@/lib/email';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/server';
import { czAccountNumber, formatIban, spayd } from '@/lib/payment';
import { fetchPrepay } from '@/lib/prepay';
import type { PaidVia } from '@/lib/order-flow';
import { scheduleWatchFlush } from '@/lib/watch';

export async function setOrderStatus(form: FormData) {
  const supabase = await createClient();
  const id = String(form.get('id'));
  const op = String(form.get('op') ?? 'status');
  // Zaplaceno (kupující) a Nepřišla (prodejce) stav nemění, jen zapíšou platbu a napíšou do chatu.
  if (op === 'mark_paid' || op === 'not_received') {
    if (op === 'mark_paid') await supabase.rpc('mark_order_paid_via', { target: id, p_via: String(form.get('via') ?? '') });
    else await supabase.rpc('payment_not_received', { target: id });
    revalidatePath('/objednavky');
    revalidatePath('/', 'layout');
    return;
  }
  // Kupující: souhlas se zvýšenou dopravou, nebo zrušení objednávky.
  if (op === 'ship_accept' || op === 'ship_reject') {
    const { error } = await supabase.rpc('answer_shipping_change', { target: id, p_accept: op === 'ship_accept' });
    if (!error && op === 'ship_reject') await scheduleWatchFlush();
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
  refreshCatalog();
}

export interface ShipChangeState { error?: string; ok?: boolean }

/** Prodejce upraví dopravu u objednávky (DS DeliveryPayment › Úprava dopravy). Strop a pravidla hlídá databáze. */
export async function changeShipping(_prev: ShipChangeState, form: FormData): Promise<ShipChangeState> {
  const id = String(form.get('id') ?? '');
  const price = Number(form.get('price'));
  const preset = String(form.get('reason') ?? '').trim();
  const note = String(form.get('note') ?? '').trim();
  const reason = [preset === 'Jiný důvod' ? '' : preset, note].filter(Boolean).join(': ').slice(0, 200);
  if (!Number.isInteger(price) || price < 0 || price > 1000) return { error: 'Cena dopravy musí být 0 až 1 000 Kč.' };
  if (reason.length < 3) return { error: 'Napište kupujícímu důvod.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('change_order_shipping', { target: id, p_price: price, p_reason: reason });
  if (error) return { error: error.code === 'P0001' ? `${error.message.replace(/\.$/, '')}.` : 'Dopravu se nepodařilo upravit.' };
  revalidatePath('/objednavky');
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Platba předem pro bublinu ve zprávách (DS Messages › QR platba v bublině, OrderPayment › Platba předem). */
export interface ChatPayment { account: string | null; owner: string | null; paypalMe: string | null; revtag: string | null; amount: number; vs: number; qr: string | null }

/** Načte se až po kliknutí na „Zaplatit“; databáze údaje vrátí jen účastníkům potvrzené objednávky. */
export async function orderPaymentQr(id: string): Promise<ChatPayment | null> {
  const supabase = await createClient();
  const p = await fetchPrepay(supabase, id);
  if (!p) return null;
  const qr = p.iban?.startsWith('CZ') && p.account_name
    ? await QRCode.toString(spayd({ iban: p.iban, amount: p.amount, vs: p.vs, name: p.account_name }), { type: 'svg', margin: 1, width: 132 })
    : null;
  return { account: p.iban ? czAccountNumber(p.iban) ?? formatIban(p.iban) : null, owner: p.account_name, paypalMe: p.paypal_me, revtag: p.revtag, amount: p.amount, vs: p.vs, qr };
}

/** Způsoby platby předem, které prodejce u objednávky má (pro volbu u Zaplaceno). */
export async function orderPaidMethods(id: string): Promise<PaidVia[]> {
  const supabase = await createClient();
  const p = await fetchPrepay(supabase, id);
  if (!p) return [];
  return [p.iban ? 'bank' : null, p.paypal_me ? 'paypal' : null, p.revtag ? 'revolut' : null].filter((m): m is PaidVia => !!m);
}
