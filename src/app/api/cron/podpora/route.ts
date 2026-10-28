import { sendSupportEmail } from '@/lib/email';
import { createAdminClient } from '@/lib/supabase/admin';
import { SIGNATURE } from '@/lib/support';

// Odpovědi podpory, které uživatel do 30 minut nepřečetl v chatu na webu, pošleme e-mailem
// (DS Support › Chat s podporou). Vercel Cron každých 10 minut s hlavičkou Authorization: Bearer <CRON_SECRET>.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return Response.json({ sent: 0 });
  const origin = 'https://www.v4cards.com';
  const { data } = await admin.from('support_mail_queue')
    .select('id, event_id, case_id, user_id, subject, case_events(body, created_at)')
    .is('sent_at', null).lt('send_after', new Date().toISOString()).order('id').limit(50);
  const rows = (data ?? []) as unknown as Array<{
    id: number; case_id: string; user_id: string; subject: string; case_events: { body: string; created_at: string } | null;
  }>;
  let sent = 0;
  let skipped = 0;
  for (const q of rows) {
    const { data: read } = await admin.from('case_user_reads').select('read_at').eq('user_id', q.user_id).eq('case_id', q.case_id).maybeSingle();
    const ev = q.case_events;
    let ok = false;
    const seen = !!read && !!ev && Date.parse(read.read_at) >= Date.parse(ev.created_at);
    if (ev && !seen) {
      const { data: u } = await admin.auth.admin.getUserById(q.user_id);
      const email = u.user?.email;
      if (email) {
        ok = await sendSupportEmail([email], q.subject, [
          { text: ev.body },
          { text: 'Odpověď najdete i v chatu s podporou vpravo dole na v4cards.com.' },
          { text: SIGNATURE },
        ], origin, false);
      }
    }
    if (seen || !ev || ok) {
      await admin.from('support_mail_queue').update({ sent_at: new Date().toISOString(), skipped: !ok }).eq('id', q.id);
      if (ok) sent++; else skipped++;
    }
  }
  return Response.json({ sent, skipped });
}
