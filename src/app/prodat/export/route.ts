import { getSignedInUser } from '@/lib/auth';
import { getGame } from '@/lib/games';
import { csvLine, TEMPLATE_HEADER } from '@/lib/import/rows';
import { createClient } from '@/lib/supabase/server';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';

type Row = {
  price_czk: number; condition: string; language: string; quantity: number; graded: string | null; note: string | null;
  cards: { name: string; number: string; game_id: string | null; card_sets: { code: string; name: string } | null } | null;
};

// Export vlastního skladu ve stejných sloupcích jako šablona, takže jde upravit a nahrát zpátky.
export async function GET() {
  const user = await getSignedInUser();
  if (!user) return new Response('Nejdřív se přihlaste.', { status: 401 });
  const supabase = await createClient();
  const rows: Row[] = [];
  // Supabase vrací nejvýš 1000 řádků na dotaz, velký sklad čteme po stránkách.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('listings')
      .select('price_czk, condition, language, quantity, graded, note, cards(name, number, game_id, card_sets(code, name))')
      .eq('seller_id', user.id)
      .gt('quantity', 0)
      .order('created_at')
      .range(from, from + 999);
    if (error) return new Response('Export se nepovedl, zkuste to prosím znovu.', { status: 500 });
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  const lines = [
    csvLine(TEMPLATE_HEADER),
    ...rows.map((l) => csvLine([
      l.cards?.game_id ? getGame(l.cards.game_id)?.name ?? l.cards.game_id : '',
      l.cards?.name, l.cards?.card_sets?.code, l.cards?.card_sets?.name, l.cards?.number,
      l.condition, LANGUAGE_NAMES[l.language as Language] ?? l.language, l.price_czk, l.quantity, l.graded, l.note,
    ])),
  ];
  const day = new Date().toISOString().slice(0, 10);
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="v4cards-sklad-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
