'use server';

// Přátelé: žádost, přijetí, odmítnutí a odebrání (databázové funkce friend_*).
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type FriendStatus = 'none' | 'outgoing' | 'incoming' | 'friends';
type Op = 'request' | 'accept' | 'decline' | 'remove';

export async function friendAction(other: string, op: Op): Promise<FriendStatus | { error: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Nejste přihlášeni.' };
  const { data, error } = op === 'request' ? await supabase.rpc('friend_request', { p_other: other })
    : op === 'remove' ? await supabase.rpc('friend_remove', { p_other: other })
    : await supabase.rpc('friend_respond', { p_other: other, p_accept: op === 'accept' });
  if (error) return { error: 'Nepovedlo se, zkuste to znovu.' };
  revalidatePath(`/prodejci/${other}`);
  revalidatePath('/ucet/pratele');
  return data as FriendStatus;
}
