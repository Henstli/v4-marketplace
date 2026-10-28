import { createAdminClient } from '@/lib/supabase/admin';
import { flushWatchAlerts } from '@/lib/watch';

// Denní dorovnání e-mailů čekajícím (hlavně pro rezervace, které vypršely samy v databázi)
// a mazání starých příloh hlášení.
// Vercel Cron posílá hlavičku Authorization: Bearer <CRON_SECRET>.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  // Cron volá adresu nasazení na vercel.app, odkazy v e-mailu ale mají vést na hlavní doménu.
  const origin = 'https://www.v4cards.com';
  const sent = await flushWatchAlerts(origin);
  const purged = await purgeOldReportFiles() + await purgeOldCaseFiles();
  // Případy podpory, hlášení, nahlášení obsahu a záznamy moderace po 3 letech (purge_support_records).
  const admin = createAdminClient();
  const retention = admin ? (await admin.rpc('purge_support_records')).data : null;
  return Response.json({ sent, purged, retention });
}

/**
 * Přílohy uzavřených hlášení po 90 dnech smažeme (DS Reports › Přílohy, zásady ochrany OÚ).
 * Volá denní cron se service_role klíčem; hlášení samotné zůstává kvůli opakovaným podvodům.
 */
async function purgeOldReportFiles(): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;
  const before = new Date(Date.now() - 90 * 864e5).toISOString();
  const { data } = await admin
    .from('report_files')
    .select('id, path, reports!inner(closed_at)')
    .lt('reports.closed_at', before)
    .limit(500);
  const rows = (data ?? []) as Array<{ id: string; path: string }>;
  if (!rows.length) return 0;
  const { error } = await admin.storage.from('report-files').remove(rows.map((r) => r.path));
  if (error) return 0;
  await admin.from('report_files').delete().in('id', rows.map((r) => r.id));
  return rows.length;
}

/** Přílohy z formuláře Napsat podpoře smažeme 90 dní po vyřešení případu (DS Support › Napsat podpoře). */
async function purgeOldCaseFiles(): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;
  const before = new Date(Date.now() - 90 * 864e5).toISOString();
  const { data } = await admin
    .from('case_files')
    .select('id, path, support_cases!inner(status, resolved_at)')
    .eq('support_cases.status', 'resolved')
    .lt('support_cases.resolved_at', before)
    .limit(500);
  const rows = (data ?? []) as Array<{ id: string; path: string }>;
  if (!rows.length) return 0;
  const { error } = await admin.storage.from('support-files').remove(rows.map((r) => r.path));
  if (error) return 0;
  await admin.from('case_files').delete().in('id', rows.map((r) => r.id));
  return rows.length;
}
