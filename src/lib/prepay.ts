import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Údaje k platbě předem (účet jen u zapnutého převodu, PayPal.Me, Revtag), jen pro účastníky potvrzené objednávky. */
export interface PrepayRow { iban: string | null; account_name: string | null; paypal_me: string | null; revtag: string | null; amount: number; vs: number }

export async function fetchPrepay(supabase: Supabase, orderId: string): Promise<PrepayRow | null> {
  const { data } = await supabase.rpc('order_prepay', { target: orderId });
  const p = (data as PrepayRow[] | null)?.[0];
  return p && (p.iban || p.paypal_me || p.revtag) ? p : null;
}
