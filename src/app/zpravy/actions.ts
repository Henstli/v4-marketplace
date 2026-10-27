'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { siteOrigin } from '@/lib/auth-helpers';
import { sendMessageEmail } from '@/lib/email';
import { isUserId } from '@/lib/messages';
import { createClient } from '@/lib/supabase/server';

export async function sendMessage(to: string, body: string, listingId?: string | null): Promise<{ ok?: true; error?: string }> {
  if (!isUserId(String(to))) return { error: 'Příjemce neexistuje.' };
  const text = String(body ?? '').trim();
  if (!text) return { error: 'Napište zprávu.' };
  if (text.length > 2000) return { error: 'Zpráva může mít nejvýš 2 000 znaků.' };
  const supabase = await createClient();
  // Přihlášení, limity proti spamu a dvoufázové ověření hlídá funkce send_message.
  // Dotaz k nabídce nese její id; databáze ověří, že nabídka patří jednomu z účastníků.
  const listing = listingId && isUserId(String(listingId)) ? String(listingId) : null;
  let { data, error } = await supabase.rpc('send_message', listing ? { p_to: to, p_body: text, p_listing: listing } : { p_to: to, p_body: text });
  // Bez migrace message_listing funkce s nabídkou ještě není, zpráva odejde bez odkazu.
  if (error && listing && error.code === 'PGRST202') ({ data, error } = await supabase.rpc('send_message', { p_to: to, p_body: text }));
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

/** Počet konverzací s nepřečtenou zprávou (ikona Zprávy v hlavičce). */
export async function unreadCount(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('unread_conversations');
  return Number(data ?? 0);
}

export interface UnreadSummary {
  count: number;
  /** Poslední nepřečtená zpráva (pro vyskakovací upozornění) */
  latest: { from: string; name: string; body: string; at: string } | null;
}

/** Počet nepřečtených a poslední nepřečtená zpráva (hlavička a upozornění vpravo dole). */
export async function unreadSummary(): Promise<UnreadSummary> {
  const supabase = await createClient();
  const [{ data: count }, { data: auth }] = await Promise.all([supabase.rpc('unread_conversations'), supabase.auth.getUser()]);
  const me = auth.user?.id;
  const n = Number(count ?? 0);
  if (!me || !n) return { count: n, latest: null };
  const { data: conv } = await supabase
    .from('conversations')
    .select('user_a, user_b, last_sender, last_body, last_message_at')
    .neq('last_sender', me)
    .not('last_sender', 'is', null)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conv?.last_sender) return { count: n, latest: null };
  const { data: p } = await supabase.from('profiles').select('display_name').eq('id', conv.last_sender).maybeSingle();
  return {
    count: n,
    latest: { from: conv.last_sender, name: p?.display_name ?? 'Uživatel', body: conv.last_body, at: conv.last_message_at },
  };
}
