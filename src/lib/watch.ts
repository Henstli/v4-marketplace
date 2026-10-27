import { after } from 'next/server';
import { siteOrigin } from './auth-helpers';
import { sendWatchEmail } from './email';
import { createAdminClient } from './supabase/admin';

/**
 * Pošle e-maily čekajícím, jejichž karta je znovu skladem (upozornění vytváří databáze,
 * viz card_watch_restock). Volá se po akcích, které vracejí kusy do nabídky, a denně z cronu.
 */
export async function flushWatchAlerts(siteUrl: string): Promise<number> {
  const admin = createAdminClient();
  if (!admin || !process.env.RESEND_API_KEY) return 0;
  const { data: alerts } = await admin
    .from('watch_alerts')
    .select('id, user_id, cards(name, slug)')
    .is('emailed_at', null)
    .is('seen_at', null)
    .order('created_at')
    .limit(200);
  if (!alerts?.length) return 0;

  // Nejdřív označit jako odeslané, ať dvě souběžná volání nepošlou totéž dvakrát.
  const { data: claimed } = await admin
    .from('watch_alerts')
    .update({ emailed_at: new Date().toISOString() })
    .in('id', alerts.map((a) => a.id))
    .is('emailed_at', null)
    .select('id');
  const ids = new Set((claimed ?? []).map((c) => c.id));

  const byUser = new Map<string, Array<{ name: string; slug: string }>>();
  for (const a of alerts) {
    if (!ids.has(a.id)) continue;
    const card = (Array.isArray(a.cards) ? a.cards[0] : a.cards) as { name: string; slug: string } | null;
    if (card) byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), card]);
  }
  let sent = 0;
  for (const [userId, cards] of byUser) {
    const { data } = await admin.auth.admin.getUserById(userId);
    if (!data.user?.email) continue;
    await sendWatchEmail(data.user.email, cards, siteUrl);
    sent++;
  }
  return sent;
}

/** Po odpovědi rozešle čekajícím e-maily (pro akce, které mohou vrátit kartu do nabídky). */
export async function scheduleWatchFlush(): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const origin = await siteOrigin();
  after(() => flushWatchAlerts(origin).then(() => undefined).catch(() => undefined));
}
