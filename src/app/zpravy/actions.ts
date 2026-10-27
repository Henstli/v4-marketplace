'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { siteOrigin } from '@/lib/auth-helpers';
import { sendMessageEmail } from '@/lib/email';
import { isUserId } from '@/lib/messages';
import { createClient } from '@/lib/supabase/server';

export async function sendMessage(to: string, body: string): Promise<{ ok?: true; error?: string }> {
  if (!isUserId(String(to))) return { error: 'Příjemce neexistuje.' };
  const text = String(body ?? '').trim();
  if (!text) return { error: 'Napište zprávu.' };
  if (text.length > 2000) return { error: 'Zpráva může mít nejvýš 2 000 znaků.' };
  const supabase = await createClient();
  // Přihlášení, limity proti spamu a dvoufázové ověření hlídá funkce send_message.
  const { data, error } = await supabase.rpc('send_message', { p_to: to, p_body: text });
  if (error) return { error: error.message || 'Zprávu se nepodařilo odeslat. Zkuste to prosím znovu.' };
  const conversation = data as string;
  const [origin, { data: auth }] = await Promise.all([siteOrigin(), supabase.auth.getUser()]);
  // Příjemce otevře konverzaci s odesílatelem.
  const link = `${origin}/zpravy/${auth.user?.id ?? ''}`;
  // E-mail příjemci jen jednou za dávku nepřečtených zpráv (rozhoduje databáze).
  after(async () => {
    const { data: claim } = await supabase.rpc('claim_message_email', { p_conversation: conversation });
    const row = (claim as Array<{ email: string | null; sender_name: string | null }> | null)?.[0];
    if (row?.email) await sendMessageEmail(row.email, row.sender_name ?? 'Uživatel V4cards', text, link);
  });
  revalidatePath('/zpravy', 'layout');
  return { ok: true };
}
