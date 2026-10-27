'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type WatchResult = { ok: true } | { error: 'login' | 'failed' };

/** Přidá kartu do čekacího pořadníku. Upozornění přijde, až bude znovu skladem. */
export async function watchCard(cardId: string): Promise<WatchResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'login' };
  const { error } = await supabase.from('card_watches').upsert({ user_id: auth.user.id, card_id: cardId }, { ignoreDuplicates: true });
  if (error) return { error: 'failed' };
  revalidatePath('/ucet/hlidane');
  return { ok: true };
}

export async function unwatchCard(form: FormData) {
  const supabase = await createClient();
  await supabase.from('card_watches').delete().eq('card_id', String(form.get('cardId')));
  revalidatePath('/ucet/hlidane');
}
