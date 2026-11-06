import type { createClient } from '@/lib/supabase/server';
import { getGame } from '@/lib/games';
import { loadHistory, parsePeriod } from '../history';

/**
 * Přehled za období (PDF) podle plátna: světlý dokument A4 k tisku (v prohlížeči Uložit jako PDF).
 * Souhrn, prodeje podle her, nejprodávanější karty, největší změny cen; u obchodu navíc K prověření, inventury a změny podle lidí.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const nf = (n: number) => Math.round(n).toLocaleString('cs-CZ').replace(/\s/g, ' ');
const kc = (n: number) => `${nf(n)} Kč`;
const ar = (n: number) => (n === 0 ? '0 Kč' : `${n < 0 ? '▼' : '▲'} ${kc(Math.abs(n))}`);
const cls = (n: number) => (n < 0 ? 'dn' : n > 0 ? 'up' : '');
const SOLD = ['confirmed', 'pending_payment', 'paid', 'shipped', 'delivered'];
const TZ = 'Europe/Prague';
const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric' })} ${d.toLocaleTimeString('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}`;
};

export async function historyDoc(supabase: Supabase, owner: string, od: string | null, doo: string | null, authorName: string): Promise<Response> {
  const period = parsePeriod('vlastni', od ?? undefined, doo ?? undefined);
  const { data: prof } = await supabase.from('profiles').select('display_name, kind').eq('id', owner).maybeSingle();
  const p = prof as { display_name?: string; kind?: string } | null;
  const shop = p?.kind === 'shop';
  const [h, { data: orders }, { data: offer }] = await Promise.all([
    loadHistory(supabase, owner, shop, period),
    supabase.from('orders').select('id, order_items(quantity, price_czk, card_id, condition)').eq('seller_id', owner).in('status', SOLD)
      .gte('created_at', period.from).lt('created_at', period.to).limit(2000),
    supabase.from('listings').select('price_czk, quantity').eq('seller_id', owner).gt('quantity', 0).is('removed_at', null).not('price_czk', 'is', null).limit(20000),
  ]);
  type OI = { quantity: number; price_czk: number; card_id: string | null; condition: string };
  const items = ((orders ?? []) as { order_items: OI[] }[]).flatMap((o) => o.order_items);
  const ids = [...new Set(items.map((i) => i.card_id).filter(Boolean) as string[])];
  const cards = new Map<string, { name: string; game: string }>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from('cards').select('id, name, game_id').in('id', ids.slice(i, i + 150));
    for (const c of (data ?? []) as { id: string; name: string; game_id: string }[]) cards.set(c.id, { name: c.name, game: getGame(c.game_id as never)?.name ?? c.game_id });
  }
  const soldPcs = items.reduce((s, i) => s + i.quantity, 0);
  const soldKc = items.reduce((s, i) => s + i.quantity * i.price_czk, 0);
  const byGame = new Map<string, { pcs: number; kc: number }>();
  const byCard = new Map<string, { name: string; cond: string; pcs: number; kc: number }>();
  for (const i of items) {
    const c = i.card_id ? cards.get(i.card_id) : null;
    const g = byGame.get(c?.game ?? 'Ostatní') ?? { pcs: 0, kc: 0 };
    g.pcs += i.quantity; g.kc += i.quantity * i.price_czk; byGame.set(c?.game ?? 'Ostatní', g);
    const k = `${i.card_id}|${i.condition}`;
    const b = byCard.get(k) ?? { name: c?.name ?? 'Karta', cond: i.condition, pcs: 0, kc: 0 };
    b.pcs += i.quantity; b.kc += i.quantity * i.price_czk; byCard.set(k, b);
  }

  // Sklad: přibylo a ubylo bez prodeje (změny skladu, které nejsou vrácené), změny cen.
  const live = h.entries.filter((e) => e.eventId && !e.undoneAt);
  const stockE = live.filter((e) => e.kind === 'stock' || e.kind === 'inv');
  const priceE = live.filter((e) => e.kind === 'price');
  const addKc = stockE.reduce((s, e) => s + Math.max(0, e.impact ?? 0), 0), lostKc = stockE.reduce((s, e) => s + Math.min(0, e.impact ?? 0), 0);
  const addPcs = stockE.reduce((s, e) => s + e.plus, 0), lostPcs = stockE.reduce((s, e) => s + e.minus, 0);
  const offerKc = ((offer ?? []) as { price_czk: number; quantity: number }[]).reduce((s, l) => s + l.price_czk * l.quantity, 0);
  const priceKc = priceE.reduce((s, e) => s + (e.impact ?? 0), 0);
  const pct = offerKc - priceKc > 0 ? (priceKc / (offerKc - priceKc)) * 100 : 0;
  const what = shop ? 'skladu' : 'sbírky';
  const flags = h.flags.filter((f) => f.at >= period.from && f.at < period.to);
  const people = new Map<string, { sale: number; stock: number; price: number; back: number }>();
  for (const e of h.entries) {
    const k = e.who ?? e.auto ?? 'Automaticky';
    const x = people.get(k) ?? { sale: 0, stock: 0, price: 0, back: 0 };
    if (e.revertsId) x.back++; else if (e.kind === 'sale') x.sale++; else if (e.kind === 'price') x.price++; else x.stock++;
    people.set(k, x);
  }
  const invs = h.entries.filter((e) => e.kind === 'inv');
  const now = new Date();
  const created = `${now.toLocaleDateString('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' })} ${now.toLocaleTimeString('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}`;
  const tbl = (head: string[], rows: string[][], right: number[]) => rows.length
    ? `<table><tr>${head.map((x, i) => `<th${right.includes(i) ? ' class="r"' : ''}>${x}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td${right.includes(i) ? ' class="r m"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</table>`
    : '<p class="mu">Za období nic.</p>';

  const html = `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Přehled ${what} ${esc(p?.display_name ?? '')} ${period.od}–${period.do}</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:12mm}
*{box-sizing:border-box}
body{margin:0;background:#e9ebee;color:#0e1116;font:400 10.5pt/1.45 Inter,Arial,sans-serif}
.bar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;padding:12px 20px;background:#0e1116;color:#e8ecf1;font-size:13px}
.bar span{flex:1;color:#a3adbb}
.bar button{font:600 13px Inter,Arial,sans-serif;height:36px;padding:0 14px;border-radius:10px;border:1px solid #7cf2c8;background:#7cf2c8;color:#0b1f18;cursor:pointer}
.doc{width:210mm;min-height:297mm;margin:20px auto;background:#fff;padding:13mm 14mm 11mm;box-shadow:0 10px 30px rgba(0,0,0,.15);display:flex;flex-direction:column;gap:18px}
.mu{color:#4a5462}.m{font-family:'JetBrains Mono',Consolas,monospace;font-weight:500}.up{color:#0b7a56}.dn{color:#b4530f}
h1{margin:0;font:700 22pt/1.2 'Space Grotesk',sans-serif;letter-spacing:-.01em}
h2{margin:0 0 6px;font:600 12pt 'Space Grotesk',sans-serif}
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0e1116;padding-bottom:12px}
.hd .k{font:600 8.5pt Inter;letter-spacing:.1em;text-transform:uppercase}
.logo{display:flex;align-items:center;gap:8px}.logo i{width:26px;height:26px;border-radius:6px;background:#0b7a56;color:#fff;display:grid;place-items:center;font:700 10pt 'Space Grotesk';font-style:normal}.logo b{font:700 13pt 'Space Grotesk'}
.kv{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.kv div{border:1px solid #d5dbe3;border-radius:8px;padding:9px 11px}
.kv small{display:block;color:#4a5462;font-size:9pt}.kv b{display:block;font:700 15pt/1.3 'Space Grotesk',sans-serif}.kv i{font:500 9pt 'JetBrains Mono',monospace;font-style:normal;color:#4a5462}
table{width:100%;border-collapse:collapse}
th{text-align:left;font:600 8pt Inter;letter-spacing:.08em;text-transform:uppercase;color:#4a5462;background:#eef1f4;padding:5px 8px}
td{padding:5px 8px;border-top:1px solid #d5dbe3;font-size:9.5pt}
.r{text-align:right}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
section{break-inside:avoid}
.ft{margin-top:auto;display:flex;justify-content:space-between;border-top:1px solid #d5dbe3;padding-top:10px;color:#4a5462;font-size:9pt}
@media print{body{background:#fff}.bar{display:none}.doc{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}}
</style></head><body>
<div class="bar"><span>V okně tisku zvolte <b>Uložit jako PDF</b>.</span><button type="button" onclick="window.print()">Uložit jako PDF</button></div>
<main class="doc">
  <div class="hd">
    <div style="display:flex;flex-direction:column;gap:4px">
      <span class="mu k">Historie ${what} · Přehled za období</span>
      <h1>${esc(period.label)}</h1>
      <span class="mu">${esc(p?.display_name ?? '')} · všechny změny${shop ? ' · všechna místa · všichni zaměstnanci' : ''}</span>
    </div>
    <div class="logo"><i>V4</i><b>V4cards</b></div>
  </div>
  <div class="kv">
    <div><small>Prodáno</small><b>${nf(soldPcs)} ks</b><i class="up">${ar(soldKc)}</i></div>
    <div><small>Přibylo do ${shop ? 'skladu' : 'sbírky'}</small><b>${nf(addPcs)} ks</b><i>v hodnotě ${kc(addKc)}</i></div>
    <div><small>Ubylo bez prodeje</small><b>${nf(lostPcs)} ks</b><i class="dn">${ar(lostKc)}</i></div>
    <div><small>Hodnota nabídky</small><b>${kc(offerKc)}</b><i class="${cls(priceKc)}">${priceKc ? `${priceKc < 0 ? '▼' : '▲'} ${Math.abs(pct).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} % za období` : 'ceny beze změny'}</i></div>
  </div>
  <section><h2>Prodeje podle her</h2>${tbl(['Hra', 'Kusů', 'Tržba', 'Podíl'],
    [...byGame].sort((a, b) => b[1].kc - a[1].kc).map(([g, x]) => [esc(g), nf(x.pcs), kc(x.kc), `${soldKc ? Math.round((x.kc / soldKc) * 100) : 0} %`]), [1, 2, 3])}</section>
  <section><h2>Nejprodávanější karty</h2>${tbl(['Karta', 'Stav', 'Kusů', 'Tržba'],
    [...byCard.values()].sort((a, b) => b.kc - a.kc).slice(0, 8).map((c) => [esc(c.name), `<span class="m">${esc(c.cond)}</span>`, nf(c.pcs), kc(c.kc)]), [2, 3])}</section>
  <section><h2>Největší změny cen</h2>${tbl(['Kdy', 'Karta / změna', ...(shop ? ['Kdo'] : []), 'Dopad'],
    [...priceE].sort((a, b) => Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0)).slice(0, 6).map((e) => [`<span class="m">${when(e.at)}</span>`, esc(e.title + (e.detail && e.multi > 1 ? ` (${e.detail})` : '')),
      ...(shop ? [esc(e.who ?? e.auto ?? '')] : []), `<span class="${cls(e.impact ?? 0)}">${ar(e.impact ?? 0)}</span>`]), [shop ? 3 : 2])}</section>
  ${shop ? `<div class="two">
    <section><h2>K prověření</h2>${tbl(['Stav', 'Počet'], [
      ['Čeká na prověření', `<span class="dn">${flags.filter((f) => !f.resolvedAt).length}</span>`],
      ['V pořádku', String(flags.filter((f) => f.resolution === 'ok').length)],
      ['Vráceno', String(flags.filter((f) => f.resolution === 'undone').length)],
      ['Vyřešilo se samo', String(flags.filter((f) => f.resolution === 'auto').length)]], [1])}</section>
    <section><h2>Inventury</h2>${tbl(['Místo', 'Karet', 'Rozdíl'], invs.map((e) => [esc(`${e.places[0] ?? ''}${e.who ? ` · ${e.who}` : ''}`), nf(e.multi),
      e.impact ? `<span class="${cls(e.impact)}">${ar(e.impact)}</span>` : 'sedí']), [1, 2])}</section>
  </div>
  <section><h2>Změny podle lidí</h2>${tbl(['Kdo', 'Prodeje', 'Sklad', 'Ceny', 'Vráceno'],
    [...people].sort((a, b) => a[0].localeCompare(b[0], 'cs')).map(([k, x]) => [esc(k), nf(x.sale), nf(x.stock), nf(x.price), nf(x.back)]), [1, 2, 3, 4])}</section>` : ''}
  <div class="ft"><span>Vytvořeno ${esc(created)} · ${esc(authorName)} · www.v4cards.com</span><span class="m">${esc(period.label)}</span></div>
</main>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
