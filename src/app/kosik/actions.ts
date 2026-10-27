'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { siteOrigin } from '@/lib/auth-helpers';
import { sendOrderEmail } from '@/lib/email';
import { createClient } from '@/lib/supabase/server';

export interface PlaceOrderResult {
  error?: string;
  orderIds?: string[];
}

export interface SellerShipping {
  shipping: number;
  freeFrom: number | null;
  /** Místo osobního předání, null když ho prodejce nenabízí */
  pickupPlace: string | null;
}

/** Ceník dopravy prodejců v košíku (profily jsou veřejné). */
export async function getSellerShipping(sellerIds: string[]): Promise<Record<string, SellerShipping>> {
  if (!sellerIds.length) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, shipping_czk, free_shipping_from, pickup, pickup_place')
    .in('id', sellerIds.slice(0, 100));
  return Object.fromEntries((data ?? []).map((p) => [p.id, {
    shipping: p.shipping_czk,
    freeFrom: p.free_shipping_from,
    pickupPlace: p.pickup ? p.pickup_place || 'po domluvě' : null,
  }]));
}

export async function placeOrder(items: Array<{ listingId: string; quantity: number }>, pickup: string[] = []): Promise<PlaceOrderResult> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: 'Pro objednávku se nejdřív přihlaste.' };

  const { data, error } = await supabase.rpc('place_order', {
    items: items.map((i) => ({ listing_id: i.listingId, quantity: i.quantity })),
    // Bez osobního předání parametr neposíláme, funkce má výchozí prázdný seznam.
    ...(pickup.length ? { pickup } : {}),
  });
  // Chyby z databáze jsou psané česky pro zákazníka (viz place_order).
  if (error) return { error: error.message || 'Objednávku se nepodařilo vytvořit.' };

  const orderIds = (data ?? []) as string[];
  const origin = await siteOrigin();
  // Každý prodejce dostane e-mail o nové objednávce, odpověď kupujícímu kvůli tomu nezdržujeme.
  after(() => Promise.all(orderIds.map((id) => sendOrderEmail(supabase, id, 'requested', user.displayName, origin))));

  revalidatePath('/', 'layout');
  return { orderIds };
}
