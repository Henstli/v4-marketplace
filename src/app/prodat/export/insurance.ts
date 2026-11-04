import { createHash } from 'node:crypto';
import { getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';
import type { StockRow } from '../data';

/**
 * Soupis sbírky (skladu) k pojištění jako tisknutelný dokument (v prohlížeči Uložit jako PDF).
 * Pojišťovna při škodě chce doložit, že věci máte, v jakém jsou stavu a jakou mají hodnotu, a to každý kus zvlášť:
 * proto identifikace vlastníka, datum ocenění, metoda ocenění, souhrn, fotky nejcennějších karet, úplný soupis a prohlášení s podpisem.
 */

const COND: Record<string, string> = {
  MT: 'Mint (MT)', NM: 'Near Mint (NM)', EX: 'Excellent (EX)', GD: 'Good (GD)', LP: 'Light Played (LP)', PL: 'Played (PL)',
};
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const nf = (n: number) => Math.round(n).toLocaleString('cs-CZ').replace(/\s/g, ' ');
const kc = (n: number) => `${nf(n)} Kč`;
const pl = (n: number, w: [string, string, string]) => `${nf(n)} ${n === 1 ? w[0] : n >= 2 && n <= 4 ? w[1] : w[2]}`;

export type InsuranceInput = {
  rows: StockRow[];
  owned: (r: StockRow) => number;
  ownerId: string;
  ownerName: string;
  shop: boolean;
  /** Jen vybrané řádky (soupis části sbírky) */
  partial: boolean;
  /** Pro odkaz Stáhnout tabulku (CSV) se stejným výběrem */
  ids: string;
  obchod: string;
};

export function insuranceHtml(o: InsuranceInput): string {
  const now = new Date();
  const dateCz = now.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Prague' });
  const timeCz = now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' });
  const items = o.rows.map((r) => {
    const n = o.owned(r);
    const unit = r.market ?? r.price ?? null;
    return { r, n, unit, value: (unit ?? 0) * n, game: r.card?.game ? getGame(r.card.game)?.name ?? r.card.game : 'Ostatní' };
  });
  const pcs = items.reduce((s, i) => s + i.n, 0);
  const total = items.reduce((s, i) => s + i.value, 0);
  const buy = items.reduce((s, i) => s + (i.r.buyPrice ?? 0) * i.n, 0);
  const noBuy = items.filter((i) => i.r.buyPrice == null).reduce((s, i) => s + i.n, 0);
  const noMarket = items.filter((i) => i.r.market == null);
  const noValue = items.filter((i) => i.unit == null);

  // Číslo dokumentu: otisk obsahu (vlastník, čas, řádky), aby šlo poznat pozdější úpravu soupisu.
  const docNo = createHash('sha256')
    .update(`${o.ownerId}|${now.toISOString()}|${items.map((i) => `${i.r.id}:${i.n}:${i.unit ?? ''}`).join(',')}`)
    .digest('hex').slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');

  const byGame = new Map<string, { pcs: number; value: number; rows: typeof items }>();
  for (const i of items) {
    const g = byGame.get(i.game) ?? { pcs: 0, value: 0, rows: [] };
    g.pcs += i.n; g.value += i.value; g.rows.push(i);
    byGame.set(i.game, g);
  }
  const games = [...byGame].sort((a, b) => b[1].value - a[1].value);
  for (const [, g] of games) g.rows.sort((a, b) => b.value - a.value || (a.r.card?.name ?? '').localeCompare(b.r.card?.name ?? '', 'cs'));

  const top = [...items].filter((i) => i.unit != null && i.unit > 0 && i.r.card?.image).sort((a, b) => (b.unit ?? 0) - (a.unit ?? 0)).slice(0, 12);
  const what = o.shop ? 'skladu' : 'sbírky';
  const cardLine = (i: (typeof items)[number]) =>
    `${esc(i.r.card?.setName ?? '')}${i.r.card?.setCode ? ` (${esc(i.r.card.setCode)})` : ''}${i.r.card?.number ? ` · č. ${esc(i.r.card.number)}` : ''}`;

  let row = 0;
  const list = games.map(([name, g]) => `
    <tr class="grp"><td colspan="${o.shop ? 9 : 7}">${esc(name)} <span>${pl(g.pcs, ['kus', 'kusy', 'kusů'])} · ${kc(g.value)}</span></td></tr>
    ${g.rows.map((i) => `<tr>
      <td class="num">${++row}</td>
      <td><b>${esc(i.r.card?.name ?? 'Karta')}</b><small>${cardLine(i)}</small></td>
      <td>${esc(o.shop ? i.r.condition : COND[i.r.condition] ?? i.r.condition)}</td>
      <td>${esc(LANGUAGE_NAMES[i.r.language as Language] ?? i.r.language)}</td>
      ${o.shop ? `<td>${esc(i.r.location ?? '')}</td>` : ''}
      <td class="r">${nf(i.n)}</td>
      ${o.shop ? `<td class="r">${i.r.buyPrice != null ? kc(i.r.buyPrice) : '—'}</td>` : ''}
      <td class="r">${i.unit != null ? kc(i.unit) : '—'}${i.r.market == null && i.unit != null ? '<sup>*</sup>' : ''}</td>
      <td class="r"><b>${i.unit != null ? kc(i.value) : '—'}</b></td>
    </tr>`).join('')}`).join('');

  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Soupis ${what} k pojištění ${esc(o.ownerName)} ${now.toISOString().slice(0, 10)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:14mm 12mm 16mm}
*{box-sizing:border-box}
body{margin:0;background:#e9ebee;color:#111;font:400 10.5pt/1.4 Inter,Arial,sans-serif}
.bar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;padding:12px 20px;background:#0e1116;color:#e8ecf1;font-size:13px}
.bar span{flex:1;color:#a3adbb}
.bar a,.bar button{font:600 13px Inter,Arial,sans-serif;height:36px;padding:0 14px;border-radius:10px;border:1px solid #3a4250;background:#171c24;color:#e8ecf1;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.bar button.p{background:#7cf2c8;border-color:#7cf2c8;color:#0b1f18}
.doc{width:210mm;min-height:297mm;margin:20px auto;background:#fff;padding:14mm 12mm;box-shadow:0 10px 30px rgba(0,0,0,.15)}
h1{font-size:20pt;margin:0 0 2px;letter-spacing:-.01em}
h2{font-size:11pt;margin:20px 0 8px;text-transform:uppercase;letter-spacing:.06em;color:#333}
.hd{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111;padding-bottom:10px}
.hd .sub{color:#555}
.hd .meta{text-align:right;white-space:nowrap;font-size:9.5pt;color:#333;line-height:1.5}
.hd .meta b{font-family:'JetBrains Mono',Consolas,monospace;letter-spacing:.02em}
.kv{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #bbb;border-radius:6px;margin-top:14px}
.kv div{padding:8px 12px;border-left:1px solid #ddd}.kv div:first-child{border-left:0}
.kv small{display:block;color:#666;font-size:8.5pt;text-transform:uppercase;letter-spacing:.05em}
.kv b{font-size:13pt}
.kv .big b{font-size:16pt}
.box{border:1px solid #ddd;background:#fafafa;border-radius:6px;padding:10px 12px;font-size:9.5pt;color:#333}
.box p{margin:0 0 4px}.box p:last-child{margin:0}
table{width:100%;border-collapse:collapse}
th{font-size:8pt;text-transform:uppercase;letter-spacing:.05em;color:#555;text-align:left;border-bottom:1.5px solid #111;padding:5px 6px}
td{border-bottom:1px solid #e3e3e3;padding:5px 6px;vertical-align:top;font-size:9.5pt}
td small{display:block;color:#666;font-size:8.5pt}
td.r,th.r{text-align:right;white-space:nowrap}
td.num{color:#888;font-size:8.5pt;width:28px}
tr.grp td{background:#f1f2f4;font-weight:700;border-bottom:1px solid #ccc;padding-top:7px}
tr.grp span{font-weight:500;color:#555;margin-left:8px}
tr.sum td{border-top:1.5px solid #111;border-bottom:0;font-weight:700;font-size:10.5pt}
thead{display:table-header-group}tr{break-inside:avoid}
.keep{break-inside:avoid}
.gal{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
.gal figure{margin:0;break-inside:avoid;text-align:center}
.gal .im{position:relative;aspect-ratio:63/88;background:#f4f5f7;border-radius:4px;overflow:hidden}
.gal img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.gal figcaption{font-size:7.5pt;color:#333;line-height:1.25;margin-top:3px}
.gal figcaption b{display:block;font-size:8pt;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:26px;break-inside:avoid}
.sign div{border-top:1px solid #111;padding-top:4px;font-size:9pt;color:#444}
.decl{break-inside:avoid}
.foot{margin-top:18px;font-size:8.5pt;color:#666;border-top:1px solid #ddd;padding-top:8px}
@media print{body{background:#fff}.bar{display:none}.doc{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}}
</style></head><body>
<div class="bar">
  <span>V okně tisku zvolte <b>Uložit jako PDF</b>. Dokument má ${games.length ? pl(row, ['řádek', 'řádky', 'řádků']) : '0 řádků'}.</span>
  <form method="post" action="/prodat/export" style="margin:0"><input type="hidden" name="druh" value="pojisteni_csv"><input type="hidden" name="ids" value="${esc(o.ids)}"><input type="hidden" name="obchod" value="${esc(o.obchod)}"><button type="submit">Stáhnout jako tabulku (CSV)</button></form>
  <button type="button" class="p" onclick="window.print()">Uložit jako PDF</button>
</div>
<main class="doc">
  <div class="hd">
    <div>
      <h1>Soupis ${what} sběratelských karet k pojištění</h1>
      <div class="sub">Vlastník: <b>${esc(o.ownerName)}</b>${o.partial ? ' · soupis vybraných karet' : ''}</div>
      <div class="sub">Ocenění k datu: <b>${esc(dateCz)}</b>, ${esc(timeCz)}</div>
    </div>
    <div class="meta">Číslo soupisu<br><b>${docNo}</b><br>Vystaveno přes V4cards<br>v4cards.com</div>
  </div>

  <div class="kv">
    <div class="big"><small>Celková tržní hodnota</small><b>${kc(total)}</b></div>
    <div><small>Počet kusů</small><b>${nf(pcs)}</b></div>
    <div><small>Položek v soupisu</small><b>${nf(items.length)}</b></div>
    ${o.shop ? `<div><small>Nákupní hodnota</small><b>${kc(buy)}</b></div>` : `<div><small>Her</small><b>${nf(games.length)}</b></div>`}
  </div>

  <h2>Jak je hodnota určena</h2>
  <div class="box">
    <p><b>Tržní cena za kus</b> je průměrná prodejní cena karty na V4cards za poslední den s prodejem; pokud prodej není, nejnižší aktuální nabídka na V4cards. Odpovídá tedy částce, za kterou lze stejnou kartu ve stejném stavu dnes znovu pořídit.</p>
    <p>Ceny jsou v Kč, k datu a času ocenění uvedenému výše. Hodnota řádku = tržní cena za kus × počet kusů. Stav karty je uveden podle mezinárodní stupnice: ${Object.values(COND).join(', ')}.</p>
    ${noMarket.length ? `<p>U ${pl(noMarket.length, ['položky', 'položek', 'položek'])} tržní cena není k dispozici${noValue.length < noMarket.length ? '; kde je to možné, je uvedena prodejní cena vlastníka (označeno *)' : ''}${noValue.length ? `, ${pl(noValue.length, ['položka', 'položky', 'položek'])} je bez ceny a do součtu nevstupuje` : ''}.</p>` : ''}
    ${o.shop && noBuy ? `<p>Nákupní hodnota je součet zadaných nákupních cen; ${pl(noBuy, ['kus', 'kusy', 'kusů'])} nákupní cenu nemá.</p>` : ''}
  </div>

  <h2>Souhrn podle her</h2>
  <table>
    <thead><tr><th>Hra</th><th class="r">Kusů</th><th class="r">Tržní hodnota</th><th class="r">Podíl</th></tr></thead>
    <tbody>
      ${games.map(([n, g]) => `<tr><td>${esc(n)}</td><td class="r">${nf(g.pcs)}</td><td class="r">${kc(g.value)}</td><td class="r">${total ? Math.round((g.value / total) * 100) : 0} %</td></tr>`).join('')}
      <tr class="sum"><td>Celkem</td><td class="r">${nf(pcs)}</td><td class="r">${kc(total)}</td><td class="r">100 %</td></tr>
    </tbody>
  </table>

  ${top.length ? `<section class="keep"><h2>Nejcennější karty</h2>
  <div class="gal">${top.map((i) => `<figure><div class="im"><img src="${esc(thumbUrl(i.r.card!.image!) ?? i.r.card!.image!)}" alt="" onerror="this.remove()"></div><figcaption><b>${esc(i.r.card?.name ?? '')}</b>${esc(i.r.condition)} · ${nf(i.n)}× · ${kc(i.unit ?? 0)}</figcaption></figure>`).join('')}</div>
  <p class="foot" style="margin-top:6px;border:0;padding:0">Obrázky jsou ilustrační z katalogu. Pro doložení stavu doporučujeme k soupisu přiložit vlastní fotografie nejcennějších karet (líc i rub) a uschovat doklady o nákupu.</p></section>` : ''}

  <h2>Úplný soupis</h2>
  <table>
    <thead><tr><th>#</th><th>Karta, sada, číslo</th><th>Stav</th><th>Jazyk</th>${o.shop ? '<th>Umístění</th>' : ''}<th class="r">Ks</th>${o.shop ? '<th class="r">Nákup/ks</th>' : ''}<th class="r">Cena/ks</th><th class="r">Hodnota</th></tr></thead>
    <tbody>${list}
      <tr class="sum"><td></td><td>Celkem</td><td></td><td></td>${o.shop ? '<td></td>' : ''}<td class="r">${nf(pcs)}</td>${o.shop ? `<td class="r">${kc(buy)}</td>` : ''}<td></td><td class="r">${kc(total)}</td></tr>
    </tbody>
  </table>

  <div class="decl">
    <h2>Prohlášení vlastníka</h2>
    <div class="box"><p>Prohlašuji, že karty uvedené v tomto soupisu jsou k datu ocenění v mém vlastnictví a v uvedeném stavu a počtu.</p></div>
    <div class="sign"><div>Místo a datum</div><div>Podpis vlastníka</div></div>
  </div>

  <div class="foot">Soupis č. ${docNo} vytvořil systém V4cards (v4cards.com) z údajů, které zadal vlastník; tržní ceny vycházejí z obchodů a nabídek na V4cards k datu ocenění. Nejde o znalecký posudek. Rozsah a podmínky pojištění sbírek určuje pojistná smlouva.</div>
</main>
</body></html>`;
}
