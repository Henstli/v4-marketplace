'use client';

import { createClient } from '@/lib/supabase/browser';
import type { UnreadSummary } from '@/app/zpravy/actions';

/**
 * Nepřečtené zprávy přímo ze Supabase z prohlížeče. Dotazy každých pár sekund tak nejdou přes Vercel
 * (limit požadavků), RLS pustí jen vlastní konverzace stejně jako na serveru.
 */
export async function loadUnread(): Promise<UnreadSummary> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const me = session?.user.id;
  if (!me) return { count: 0, latest: null };
  const { data: count } = await supabase.rpc('unread_conversations');
  const n = Number(count ?? 0);
  if (!n) return { count: 0, latest: null };
  const { data: conv } = await supabase
    .from('conversations')
    .select('last_sender, last_body, last_message_at')
    .neq('last_sender', me)
    .not('last_sender', 'is', null)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conv?.last_sender) return { count: n, latest: null };
  const { data: p } = await supabase.from('profiles').select('display_name').eq('id', conv.last_sender).maybeSingle();
  return { count: n, latest: { from: conv.last_sender, name: p?.display_name ?? 'Uživatel', body: conv.last_body, at: conv.last_message_at } };
}

/** Čas poslední změny v mých konverzacích (nová zpráva nebo krok objednávky); null bez přihlášení. */
export async function lastConversationChange(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('conversations')
    .select('last_message_at')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.last_message_at as string | undefined) ?? null;
}
