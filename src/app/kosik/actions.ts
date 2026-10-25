'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface PlaceOrderResult {
  error?: string;
  orderIds?: string[];
}

export async function placeOrder(items: Array<{ listingId: string; quantity: number }>): Promise<PlaceOrderResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Pro objednávku se nejdřív přihlaste.' };

  const { data, error } = await supabase.rpc('place_order', {
    items: items.map((i) => ({ listing_id: i.listingId, quantity: i.quantity })),
  });
  // Chyby z databáze jsou psané česky pro zákazníka (viz place_order).
  if (error) return { error: error.message || 'Objednávku se nepodařilo vytvořit.' };

  revalidatePath('/', 'layout');
  return { orderIds: (data ?? []) as string[] };
}
