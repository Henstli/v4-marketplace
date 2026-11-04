import { createAdminClient } from '@/lib/supabase/admin';
import { refreshCatalog } from '@/lib/catalog-refresh';

// Automatické ceny: jednou za noc (3:00 v Praze v zimě, 4:00 v létě) přepočítá ceny obchodů,
// které je mají zapnuté. Každý přepočet je v Historii skladu a jde vrátit.
// Vercel Cron posílá hlavičku Authorization: Bearer <CRON_SECRET>.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return Response.json({ changed: 0 });
  const { data, error } = await admin.rpc('stock_autoprice_run');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (Number(data) > 0) refreshCatalog();
  return Response.json({ changed: Number(data ?? 0) });
}
