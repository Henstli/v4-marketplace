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

export async function placeOrder(items: Array<{ listingId: string; quantity: number }>): Promise<PlaceOrderResult> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: 'Pro objednávku se nejdřív přihlaste.' };

  const { data, error } = await supabase.rpc('place_order', {
    items: items.map((i) => ({ listing_id: i.listingId, quantity: i.quantity })),
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
