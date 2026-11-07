import { getCurrentUser, getSignedInUser } from '@/lib/auth';
import { historyDoc } from './history-pdf';
import { loadStock, owned } from '../data';
import { getGame } from '@/lib/games';
import { csvLine, TEMPLATE_HEADER } from '@/lib/import/rows';
import { createClient } from '@/lib/supabase/server';
import { insuranceHtml } from './insurance';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';
import { xlsx } from '@/lib/xlsx';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Pick = ((id: string) => boolean) | null;

// Export skladu: druh (csv, xlsx, pojisteni, ucetni, deckbuilder), volitelně jen vybrané řádky (ids) a sklad obchodu (obchod, právo Napojení).
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  return run(sp.get('druh'), sp.get('ids'), sp.get('obchod'), sp);
}
export async function POST(req: Request) {
  const f = await req.formData();
  return run(String(f.get('druh') ?? '') || null, String(f.get('ids') ?? '') || null, String(f.get('obchod') ?? '') || null);
}

async function run(druh: string | null, idsRaw: string | null, obchod: string | null, sp?: URLSearchParams) {
  const user = await getSignedInUser();
  if (!user) return new Response('Nejdřív se přihlaste.', { status: 401 });
  const supabase = await createClient();
  let owner = user.id;
  if (obchod && obchod !== user.id) {
    if (!UUID.test(obchod)) return new Response('Obchod nenalezen.', { status: 404 });
    const { data } = await supabase.rpc('stock_perm', { p_owner: obchod, p_perm: 'conn' });
    if (data !== true) return new Response('Na export tohoto skladu nemáte právo.', { status: 403 });
    owner = obchod;
  }
  const ids = idsRaw ? new Set(idsRaw.split(',').filter((x) => UUID.test(x)).slice(0, 10000)) : null;
  const pick: Pick = ids ? (id) => ids.has(id) : null;
  if (druh === 'historie') {
    const me = await getCurrentUser();
    return historyDoc(supabase, owner, sp?.get('od') ?? null, sp?.get('do') ?? null, me?.displayName ?? '');
  }
  if (druh === 'pojisteni') return insuranceDoc(supabase, owner, pick, idsRaw ?? '', obchod ?? '');
  if (druh === 'pojisteni_csv') return insurance(supabase, owner, pick);
  if (druh === 'ucetni') return accounting(supabase, owner);
  if (druh === 'deckbuilder') return deckbuilder(supabase, owner, pick);
  // Stejné sloupce jako šablona, takže jde upravit a nahrát zpátky. Počet = všechny kusy, které máte.
  const rows = (await loadStock(supabase, owner)).filter((r) => owned(r) > 0 && (!pick || pick(r.id)));
  const table = rows.map((r) => [
    r.card?.game ? getGame(r.card.game)?.name ?? r.card.game : '',
    r.card?.name ?? '', r.card?.setCode ?? '', r.card?.setName ?? '', r.card?.number ?? '',
    r.condition, LANGUAGE_NAMES[r.language as Language] ?? r.language, r.price ?? (r.quantity > 0 ? 'dohodou' : ''), owned(r), '', '',
  ]);
  if (druh === 'xlsx') {
    const day = new Date().toISOString().slice(0, 10);
    const file = xlsx([TEMPLATE_HEADER, ...table], 'Sklad', [14, 34, 10, 30, 10, 8, 12, 12, 11, 10, 20]);
    return new Response(file as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="v4cards-sklad-${day}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  return csvFile([csvLine(TEMPLATE_HEADER), ...table.map((r) => csvLine(r))], 'sklad');
}

// Přehled pro pojištění: všechny kusy (na prodej i mimo prodej) s tržní hodnotou; obchod navíc podle míst a s nákupní cenou.
async function insurance(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, pick: Pick) {
  const [rows, { data: prof }] = await Promise.all([loadStock(supabase, userId), supabase.from('profiles').select('kind').eq('id', userId).maybeSingle()]);
  const shop = (prof as { kind?: string } | null)?.kind === 'shop';
  const items = rows.filter((r) => owned(r) > 0 && (!pick || pick(r.id))).sort((a, b) =>
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

// Soupis k pojištění jako dokument k uložení do PDF (tisk z prohlížeče).
async function insuranceDoc(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, pick: Pick, ids: string, obchod: string) {
  const [rows, { data: prof }] = await Promise.all([loadStock(supabase, userId), supabase.from('profiles').select('display_name, kind').eq('id', userId).maybeSingle()]);
  const p = prof as { display_name?: string; kind?: string } | null;
  const html = insuranceHtml({
    rows: rows.filter((r) => owned(r) > 0 && (!pick || pick(r.id))), owned, ownerId: userId, ownerName: p?.display_name ?? 'Vlastník',
    shop: p?.kind === 'shop', partial: !!pick, ids, obchod,
  });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

function csvFile(lines: string[], name: string) {
  const day = new Date().toISOString().slice(0, 10);
  return new Response('\ufeff' + lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="v4cards-${name}-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

// Přehled pro účetní: hodnota skladu k dnešku podle her (nákupní, prodejní, tržní) a obrat za 12 měsíců podle měsíců a her.
async function accounting(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const since = new Date(Date.now() - 365 * 86400000).toISOString();
  const [rows, { data: orders }] = await Promise.all([
    loadStock(supabase, userId),
    supabase.from('orders').select('number, status, created_at, decided_at, total_czk, order_items(quantity, price_czk, listings(cards(game_id)))')
      .eq('seller_id', userId).in('status', ['paid', 'shipped', 'delivered']).gte('created_at', since).order('created_at').limit(5000),
  ]);
  const game = (id: string | null | undefined) => (id ? getGame(id)?.name ?? id : 'Ostatní');
  const stock = new Map<string, { pcs: number; buy: number; noBuy: number; sale: number; market: number }>();
  for (const r of rows) {
    const n = owned(r);
    if (n <= 0) continue;
    const g = game(r.card?.game);
    const a = stock.get(g) ?? { pcs: 0, buy: 0, noBuy: 0, sale: 0, market: 0 };
    a.pcs += n;
    if (r.buyPrice != null) a.buy += r.buyPrice * n; else a.noBuy += n;
    a.sale += (r.price ?? 0) * r.quantity;
    a.market += (r.market ?? r.price ?? 0) * n;
    stock.set(g, a);
  }
  const day = new Date().toLocaleDateString('cs-CZ');
  const lines = [csvLine([`Hodnota skladu k ${day}`]), csvLine(['Hra', 'Kusů', 'Nákupní hodnota (Kč)', 'Kusů bez nákupní ceny', 'Na prodej za (Kč)', 'Tržní hodnota (Kč)'])];
  const tot = { pcs: 0, buy: 0, noBuy: 0, sale: 0, market: 0 };
  for (const [g, a] of [...stock].sort((x, y) => y[1].market - x[1].market)) {
    lines.push(csvLine([g, a.pcs, a.buy, a.noBuy, a.sale, a.market]));
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += a[k];
  }
  lines.push(csvLine(['Celkem', tot.pcs, tot.buy, tot.noBuy, tot.sale, tot.market]), '');
  type O = { number: number; created_at: string; decided_at: string | null; total_czk: number;
    order_items: { quantity: number; price_czk: number; listings: { cards: { game_id: string | null } | null } | null }[] };
  const turnover = new Map<string, number>();
  for (const o of (orders ?? []) as unknown as O[]) {
    const month = (o.decided_at ?? o.created_at).slice(0, 7);
    for (const i of o.order_items ?? []) {
      const k = `${month}|${game(i.listings?.cards?.game_id)}`;
      turnover.set(k, (turnover.get(k) ?? 0) + i.quantity * i.price_czk);
    }
  }
  lines.push(csvLine(['Obrat za karty přes V4cards za 12 měsíců (bez dopravy), zaplacené a odeslané objednávky']), csvLine(['Měsíc', 'Hra', 'Obrat (Kč)']));
  let sum = 0;
  for (const [k, v] of [...turnover].sort()) { const [m, g] = k.split('|'); lines.push(csvLine([m, g, v])); sum += v; }
  lines.push(csvLine(['Celkem', '', sum]), '', csvLine(['Faktury a daňové doklady vystavuje obchod sám, V4cards je neuchovává.']));
  return csvFile(lines, 'ucetni');
}

// Pro deckbuildery: formát sbírky Moxfieldu (Count, Name, Edition, Condition, Language, Foil, Collector Number), jen Magic.
const MOX_COND: Record<string, string> = { MT: 'Mint', NM: 'Near Mint', EX: 'Good (Lightly Played)', GD: 'Played', LP: 'Played', PL: 'Heavily Played' };
const MOX_LANG: Record<string, string> = {
  en: 'English', de: 'German', ja: 'Japanese', fr: 'French', it: 'Italian', es: 'Spanish', pt: 'Portuguese', ko: 'Korean', zh: 'Chinese Simplified', ru: 'Russian', cs: 'English',
};
async function deckbuilder(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, pick: Pick) {
  const rows = (await loadStock(supabase, userId)).filter((r) => owned(r) > 0 && r.card?.game === 'magic' && (!pick || pick(r.id)));
  // Moxfield čte CSV oddělené čárkami (ne středníky jako český Excel) a bez značky BOM.
  const lines = [csvComma(['Count', 'Name', 'Edition', 'Condition', 'Language', 'Foil', 'Collector Number']),
    ...rows.map((r) => csvComma([owned(r), r.card?.name, (r.card?.setCode ?? '').toLowerCase(), MOX_COND[r.condition] ?? 'Near Mint',
      MOX_LANG[r.language] ?? 'English', '', r.card?.number]))];
  const day = new Date().toISOString().slice(0, 10);
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="v4cards-moxfield-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
const csvComma = (cells: Array<string | number | null | undefined>) =>
  cells.map((c) => { const s = c == null ? '' : String(c); return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',');
