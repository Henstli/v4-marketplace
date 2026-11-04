import { getSignedInUser } from '@/lib/auth';
import { getAccountSummary } from '@/lib/account';
import { loadStock, owned } from '../data';
import { getGame } from '@/lib/games';
import { csvLine, TEMPLATE_HEADER } from '@/lib/import/rows';
import { createClient } from '@/lib/supabase/server';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';

type Row = {
  price_czk: number | null; condition: string; language: string; quantity: number; graded: string | null; note: string | null;
  cards: { name: string; number: string; game_id: string | null; card_sets: { code: string; name: string } | null } | null;
};

// Export vlastního skladu ve stejných sloupcích jako šablona, takže jde upravit a nahrát zpátky.
export async function GET(req: Request) {
  const user = await getSignedInUser();
  if (!user) return new Response('Nejdřív se přihlaste.', { status: 401 });
  const supabase = await createClient();
  if (new URL(req.url).searchParams.get('druh') === 'pojisteni') return insurance(supabase, user.id);
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
      l.condition, LANGUAGE_NAMES[l.language as Language] ?? l.language, l.price_czk ?? 'dohodou', l.quantity, l.graded, l.note,
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

// Přehled pro pojištění: všechny kusy (na prodej i mimo prodej) s tržní hodnotou; obchod navíc podle míst a s nákupní cenou.
async function insurance(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const [rows, account] = await Promise.all([loadStock(supabase, userId), getAccountSummary()]);
  const shop = account?.kind === 'shop';
  const items = rows.filter((r) => owned(r) > 0).sort((a, b) =>
    (shop ? (a.location ?? '~').localeCompare(b.location ?? '~', 'cs') : 0) || (a.card?.name ?? '').localeCompare(b.card?.name ?? '', 'cs'));
  const head = ['Hra', 'Karta', 'Sada', 'Číslo', 'Stav', 'Jazyk', 'Kusů', ...(shop ? ['Umístění', 'Nákupní cena/ks', 'Nákupní hodnota'] : []), 'Tržní cena/ks', 'Tržní hodnota'];
  let buy = 0, market = 0, pcs = 0;
  const lines = [csvLine(head), ...items.map((r) => {
    const n = owned(r);
    pcs += n;
    buy += (r.buyPrice ?? 0) * n;
    market += (r.market ?? r.price ?? 0) * n;
    return csvLine([
      r.card?.game ? getGame(r.card.game)?.name ?? r.card.game : '', r.card?.name, r.card?.setName, r.card?.number,
      r.condition, LANGUAGE_NAMES[r.language as Language] ?? r.language, n,
      ...(shop ? [r.location ?? '', r.buyPrice ?? '', r.buyPrice != null ? r.buyPrice * n : ''] : []),
      r.market ?? r.price ?? '', (r.market ?? r.price ?? 0) * n,
    ]);
  })];
  lines.push(csvLine(['Celkem', '', '', '', '', '', pcs, ...(shop ? ['', '', buy] : []), '', market]));
  const day = new Date().toISOString().slice(0, 10);
  return new Response('\ufeff' + lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="v4cards-pojisteni-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
