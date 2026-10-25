import type { NextRequest } from 'next/server';
import { suggestCards } from '@/lib/catalog';
import { getGame, type GameId } from '@/lib/games';

// Návrhy karet pro našeptávač ve vyhledávání. Odpověď je pro všechny stejná, takže ji drží
// CDN Vercelu: časté začátky slov („char“, „pika“) se vůbec nedostanou do databáze.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = (params.get('q') ?? '').slice(0, 80);
  const hra = params.get('hra');
  const game = hra && getGame(hra) ? (hra as GameId) : undefined;
  try {
    const items = await suggestCards(q, game);
    return Response.json(items, {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' },
    });
  } catch {
    return Response.json([], { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
