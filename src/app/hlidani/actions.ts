'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type WatchResult = { ok: true } | { error: 'login' | 'failed' };

/** Přidá kartu do čekacího pořadníku. Upozornění přijde, až se objeví nabídka. */
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

/** Hlídá přihlášený uživatel kartu? (tlačítko Čekat po obnovení stránky) */
export async function isWatching(cardId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { data } = await supabase.from('card_watches').select('card_id').eq('card_id', cardId).maybeSingle();
  return !!data;
}

/** Zruší hlídání karty přímo z tlačítka Hlídáte. */
export async function stopWatching(cardId: string): Promise<WatchResult> {
  const supabase = await createClient();
  const { error } = await supabase.from('card_watches').delete().eq('card_id', cardId);
  if (error) return { error: 'failed' };
  revalidatePath('/ucet/hlidane');
  return { ok: true };
}
