import { flushWatchAlerts } from '@/lib/watch';

// Denní dorovnání e-mailů čekajícím (hlavně pro rezervace, které vypršely samy v databázi).
// Vercel Cron posílá hlavičku Authorization: Bearer <CRON_SECRET>.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  // Cron volá adresu nasazení na vercel.app, odkazy v e-mailu ale mají vést na hlavní doménu.
  const origin = 'https://www.v4cards.com';
  const sent = await flushWatchAlerts(origin);
  return Response.json({ sent });
}
