'use client';

import { DashBorder } from './DashBorder';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { fold } from '@/lib/import/columns';
import { GAMES, getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { stockChange, stockSet } from './actions';
import { cardInfo, stockBulkSet, type BulkRow, type CardInfo } from './sk-actions';
import { owned, type StockRow } from './data';
import { ExportModal } from './StockModals';
import {
  CARD_LANGS, COND_FULL, COND_ORDER, Ico, kc, LANG_FULL, langCode, Modal, nf, pl1, plA, plw, Seg, SRC,
} from './sk';

/** Souhrnná čísla do pruhu nad tabulkou, spočítaná na serveru. */
export interface StripStats {
  /** Změna hodnoty podle trhu za 30 dní v % (jen když jsou data) */
  trend: number | null;
  /** Kolik lidí hlídá nebo hledá karty, které prodáváte */
  watchers: number | null;
  /** Otevřené objednávky a kolik z nich čeká na vás */
  orders: number; ordersWaiting: number; unpaid: number;
  /** Prodáno za 30 dní */
  sold30: { pcs: number; sum: number };
  /** Nejvíc zdražená karta za 30 dní */
  riser: { name: string; pct: number; cardId: string } | null;
}

type Item = {
  r: StockRow; id: string; key: string; name: string; set: string; game: string; gameId: string; img: string | null;
  cond: string; lang: string; have: number; sale: number; keep: number; trade: number; price: number | null; market: number | null;
  loc: string; src: string; listed: number; buy: number | null; locked: boolean; upd: string;
};
type Sort = 'chg' | 'name' | 'have' | 'price';
type F = { g: Set<string>; c: Set<string>; l: Set<string>; s: Set<string>; p: Set<string> };
type BulkModal = 'sell' | 'price' | 'attr' | 'loc' | 'del' | 'export' | 'bmore' | null;

const SLOW = 60;
const days = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0);
const toItem = (r: StockRow): Item => ({
  r, id: r.id, key: r.cardId, name: r.card?.name ?? 'Karta', set: `${r.card?.setCode ?? ''} ${r.card?.number ?? ''}`.trim(),
  game: getGame(r.card?.game ?? '')?.name ?? '', gameId: r.card?.game ?? '', img: thumbUrl(r.card?.image ?? undefined) ?? null,
  cond: r.condition, lang: r.language, have: owned(r), sale: r.quantity, keep: r.keep, trade: Math.min(r.trade, owned(r)),
  price: r.price, market: r.market, loc: r.location ?? '', src: r.source, listed: r.quantity > 0 ? days(r.listedAt) : 0,
  buy: r.buyPrice, locked: r.removed || r.hidden != null, upd: r.updatedAt,
});

function issues(i: Item, shop: boolean): string[] {
  const o: string[] = [];
  if (!shop) return o;
  if (i.sale > 0 && i.price == null) o.push('Bez ceny');
  if (i.price != null && i.market) {
    const d = i.price / i.market - 1;
    if (Math.abs(d) >= 0.15) o.push(`${Math.round(Math.abs(d) * 100)} % ${d > 0 ? 'nad' : 'pod'} trhem`);
  }
  if (!i.loc) o.push('Bez umístění');
  if (i.sale > 0 && i.listed >= SLOW) o.push(`Leží ${i.listed} dní`);
  return o;
}
const locOf = (i: Item) => (i.loc ? i.loc.split(' · ')[0] : '—');
const locIn = (i: Item, v: string) => (v === '—' ? !i.loc : !!i.loc && (i.loc === v || i.loc.startsWith(`${v} ·`)));

export function StockTable({ items: rows, mode, shop, ready, canPrice, canAdd, stats, unmatched, napojeni, ordersHref, demandHref }: {
  items: StockRow[]; mode: 'all' | 'sale'; shop: boolean; ready: boolean; canPrice: boolean; canAdd: boolean;
  stats: StripStats; unmatched: number; napojeni: string | null; ordersHref: string; demandHref: string | null;
}) {
  const all = useMemo(() => rows.map(toItem).filter((i) => i.have > 0 || i.locked), [rows]);
  const [q, setQ] = useState('');
  const [f, setF] = useState<F>({ g: new Set(), c: new Set(), l: new Set(), s: new Set(), p: new Set() });
  const [forSale, setForSale] = useState<'' | 'on' | 'off'>('');
  const [attn, setAttn] = useState(false);
  const [dup, setDup] = useState(false);
  const [old, setOld] = useState(false);
  const [attnHide, setAttnHide] = useState(false);
  const [fp, setFp] = useState(false);
  const [fq, setFq] = useState('');
  const [locOpen, setLocOpen] = useState(false);
  const [view, setView] = useState<'list' | 'text'>('list');
  const [sort, setSort] = useState<Sort>('chg');
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(0);
  const [exp, setExp] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [pop, setPop] = useState<{ k: string; x: number; y: number } | null>(null);
  const [modal, setModal] = useState<BulkModal>(null);
  const [toast, setToast] = useState<{ t: string; err?: boolean; undo?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const fwrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!fp) return;
    const h = (e: MouseEvent) => { if (fwrap.current && !fwrap.current.contains(e.target as Node)) setFp(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [fp]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => setPage(1), [q, f, forSale, attn, dup, old, sort, view]);

  const sale = mode === 'sale';
  const base = useMemo(() => (sale ? all.filter((i) => i.sale > 0) : all), [all, sale]);
  const nF = f.g.size + f.c.size + f.l.size + f.s.size + f.p.size + (forSale ? 1 : 0) + (attn ? 1 : 0) + (dup ? 1 : 0) + (old ? 1 : 0);
  const fAny = !!q || nF > 0;

  const visible = useMemo(() => {
    let a = base.filter((i) => (!f.g.size || f.g.has(i.gameId)) && (!f.c.size || f.c.has(i.cond)) && (!f.l.size || f.l.has(i.lang))
      && (!f.s.size || f.s.has(i.src)) && (!f.p.size || [...f.p].some((v) => locIn(i, v))));
    if (attn) a = a.filter((i) => issues(i, shop).length);
    if (dup) a = a.filter((i) => i.have > 1);
    if (old) a = a.filter((i) => i.sale > 0 && i.listed >= SLOW);
    if (forSale === 'on') a = a.filter((i) => i.sale > 0);
    if (forSale === 'off') a = a.filter((i) => !i.sale);
    if (q) { const t = fold(q); a = a.filter((i) => fold(`${i.name} ${i.set} ${i.loc}`).includes(t)); }
    const so: Record<Sort, (x: Item, y: Item) => number> = {
      chg: (x, y) => y.upd.localeCompare(x.upd),
      name: (x, y) => x.name.localeCompare(y.name, 'cs'),
      have: (x, y) => y.have - x.have,
      price: (x, y) => (y.price ?? y.market ?? 0) - (x.price ?? x.market ?? 0),
    };
    return a.slice().sort(so[sort]);
  }, [base, f, attn, dup, old, forSale, q, sort, shop]);

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of visible) { const g = m.get(i.key); if (g) g.push(i); else m.set(i.key, [i]); }
    return [...m.values()].map((g) => g.sort((a, b) => (COND_ORDER[a.cond] - COND_ORDER[b.cond]) || a.lang.localeCompare(b.lang)));
  }, [visible]);

  const PG = view === 'text' ? 15 : 10;
  const NP = Math.max(1, Math.ceil(groups.length / PG));
  const pg = Math.min(page, NP);
  const st = (pg - 1) * PG;
  const en = Math.min(st + PG * (more + 1), groups.length);
  const shown = groups.slice(st, en);
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);
  const selItems = [...sel].map((id) => byId.get(id)).filter((i): i is Item => !!i && !i.locked);

  // ---- akce
  function done(r: { error?: string; count?: number }, text: string, undo = true) {
    if (r.error) setToast({ t: r.error, err: true });
    else setToast({ t: text, undo });
  }
  const run = (fn: () => Promise<{ error?: string; count?: number }>, text: string, after?: () => void) => start(async () => {
    const r = await fn();
    done(r, text);
    if (!r.error) after?.();
  });
  const bulk = (list: BulkRow[], title: string, text: string, kind: 'stock' | 'price' = 'stock', after?: () => void) =>
    run(() => stockBulkSet(list, title, kind), text, after);
  const needReady = (more: boolean) => {
    if (more && !ready) { setToast({ t: 'Prodávat jde až s dopravou a platbou. Doplňte je v nastavení účtu.', err: true }); return false; }
    if (!canPrice) { setToast({ t: 'Na prodej a ceny nemáte právo.', err: true }); return false; }
    return true;
  };
  const step = (i: Item, d: number) => {
    const s = Math.max(0, Math.min(i.have, i.sale + d));
    if (s === i.sale || !needReady(d > 0)) return;
    bulk([{ id: i.id, quantity: s, keep_qty: i.have - s }], `${i.name}: na prodej ${s} z ${i.have}`, `${i.name}: na prodej ${s} z ${i.have}`);
  };
  const gstep = (g: Item[], d: number) => {
    if (!needReady(d > 0)) return;
    const t = d > 0 ? g.find((x) => x.sale < x.have && !x.locked) : [...g].reverse().find((x) => x.sale > 0 && !x.locked);
    if (t) step(t, d);
  };
  const stop = (list: Item[]) => {
    if (!needReady(false)) return;
    run(() => stockChange(list.map((x) => x.id), 'unsell'), `${list[0].name}: staženo z prodeje`);
  };
  const savePrice = (list: Item[], v: number) => {
    setEdit(null);
    if (!needReady(false) || !Number.isInteger(v) || v <= 0) return;
    run(() => stockChange(list.map((x) => x.id), 'price', v), `Cena ${kc(v)} · ${list.length > 1 ? `${list.length} varianty` : list[0].name}`);
  };

  const toggle = (ids: string[], on: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  // Hlavní zaškrtávátko vybírá všechny karty podle filtru, ne jen stránku.
  const filterIds = visible.filter((i) => !i.locked).map((i) => i.id);
  const allSel = filterIds.length > 0 && filterIds.every((id) => sel.has(id));
  const someSel = !allSel && filterIds.some((id) => sel.has(id));

  // ---- pruh
  const t = useMemo(() => {
    const pcs = all.reduce((s, i) => s + i.have, 0), kinds = new Set(all.map((i) => i.key)).size;
    const onSale = all.reduce((s, i) => s + i.sale, 0), val = all.reduce((s, i) => s + i.have * (i.market ?? i.price ?? 0), 0);
    const offer = all.reduce((s, i) => s + i.sale * (i.price ?? i.market ?? 0), 0);
    const oldN = all.filter((i) => i.sale > 0 && i.listed >= SLOW).length;
    const dups = new Map<string, number>(); all.forEach((i) => dups.set(i.key, (dups.get(i.key) ?? 0) + i.have));
    const tradeN = all.filter((i) => i.trade > 0).length;
    return { pcs, kinds, onSale, val, offer, oldN, dups: [...dups.values()].filter((n) => n > 1).length, tradeN };
  }, [all]);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const sgn = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('cs-CZ')}`;
  const resetF = () => { setF({ g: new Set(), c: new Set(), l: new Set(), s: new Set(), p: new Set() }); setForSale(''); setAttn(false); setDup(false); setOld(false); setQ(''); };

  let strip: React.ReactNode;
  if (!shop && sale) strip = (
    <div className="strip">
      <div className="stc"><small>Na prodej<em>{pct(t.onSale, t.pcs)} % sbírky</em></small><b>{nf(t.onSale)} ks</b></div>
      <div className="stc"><small>Hodnota nabídky</small><b>{kc(t.offer)}</b></div>
      <div className="stc"><small>Prodáno<em style={{ color: 'var(--ink-muted)' }}>za 30 dní</em></small><b>{pl1(stats.sold30.pcs)} · {kc(stats.sold30.sum)}</b></div>
      <Link className="stc" href={ordersHref} style={{ display: 'block', padding: '12px 18px', borderLeft: '1px solid var(--line)' }}><small>Objednávky{stats.ordersWaiting ? <em>{stats.ordersWaiting} čeká na vás</em> : null}</small><b>{nf(stats.orders)}</b></Link>
    </div>
  );
  else if (shop && sale) strip = (
    <div className="strip">
      <div className="stc"><small>Na prodej<em>{pct(t.onSale, t.pcs)} % skladu</em></small><b>{nf(t.onSale)} ks</b></div>
      <div className="stc"><small>Hodnota nabídky</small><b>{kc(t.offer)}</b></div>
      {stats.watchers != null ? (
        <div className="stc" onClick={() => demandHref && (location.href = demandHref)} title="Kdo co hledá"><small>Hlídá vaše karty</small><b>{plw(stats.watchers, ['člověk', 'lidé', 'lidí'])}</b></div>
      ) : null}
      <div className="stc" onClick={() => (location.href = ordersHref)} title="K odeslání"><small>Objednávky{stats.unpaid ? <em style={{ color: 'var(--down)' }}>{stats.unpaid} nezaplacená</em> : null}</small><b>{nf(stats.orders)}</b></div>
      <div className="stc" onClick={() => { resetF(); setOld(true); }} title="Zobrazit"><small>Leží přes 60 dní<em style={{ color: 'var(--ink-muted)' }}>zvažte slevu</em></small><b>{pl1(t.oldN)}</b></div>
    </div>
  );
  else if (shop) strip = (
    <div className="strip">
      <div className="stc"><small>Kusů celkem</small><b>{nf(t.pcs)}</b></div>
      <div className="stc"><small>Druhů</small><b>{nf(t.kinds)}</b></div>
      <div className="stc" onClick={() => { resetF(); setForSale('on'); }}><small>Na prodej<em>{pct(t.onSale, t.pcs)} %</em></small><b>{nf(t.onSale)}</b></div>
      <div className="stc"><small>Hodnota podle trhu{stats.trend != null ? <em style={stats.trend < 0 ? { color: 'var(--down)' } : undefined}>{sgn(stats.trend)} %</em> : null}</small><b>{kc(t.val)}</b></div>
      <div className="sync"><span>Žádný e-shop nenapojen</span>{napojeni ? <Link className="btn sm" href={napojeni}>Napojit</Link> : null}</div>
    </div>
  );
  else strip = (
    <div className="strip">
      <div className="stc"><small>Druhů ve sbírce</small><b>{nf(t.kinds)}</b></div>
      <div className="stc"><small>Hodnota sbírky{stats.trend != null ? <em style={stats.trend < 0 ? { color: 'var(--down)' } : undefined}>{sgn(stats.trend)} % za 30 dní</em> : null}</small><b>{kc(t.val)}</b></div>
      {stats.riser ? (
        <div className="stc" onClick={() => { const i = all.find((x) => x.key === stats.riser!.cardId); if (i) setOpen(i.id); }} title="Otevřít kartu">
          <small>Nejvíc zdražila<em>+{stats.riser.pct} %</em></small><b style={{ fontSize: 15 }}>{stats.riser.name}</b>
        </div>
      ) : null}
      <div className="stc" onClick={() => { resetF(); setDup(true); }} title="Zobrazit duplicity">
        <small>Duplicity<em style={{ color: 'var(--ink-muted)' }}>{t.tradeN ? `${t.tradeN} na výměnu` : 'k prodeji nebo výměně'}</em></small><b>{nf(t.dups)}</b>
      </div>
    </div>
  );

  // ---- upozornění (obchod)
  const isList = all.map((i) => issues(i, shop));
  const nAttn = isList.filter((r) => r.length).length;
  const cnt = (k: string) => isList.filter((r) => r.some((x) => x.includes(k))).length;
  const attnParts = ([[cnt('Bez ceny'), 'bez ceny'], [cnt('trhem'), 'mimo trh'], [cnt('umístění'), 'bez umístění'], [cnt('Leží'), 'leží přes 60 dní']] as [number, string][])
    .filter((p) => p[0]);
  const attnNote = shop && !attnHide && !attn && nAttn ? (
    <div className="attn">
      <i className="adot" />
      <span>Dnes potřebuje pozornost <b>{pl1(nAttn)}</b>: {attnParts.map(([n, l], k) => <span key={l} style={{ flex: 'none' }}>{k ? ', ' : ''}<b>{n}</b> {l}</span>)}.
        {unmatched ? ` A ${unmatched} položek čeká v Nespárovaných.` : ''}</span>
      <button type="button" className="btn sm" onClick={() => setAttn(true)}>Zobrazit</button>
      <button type="button" className="x" title="Skrýt" onClick={() => setAttnHide(true)}>{Ico.x}</button>
    </div>
  ) : null;

  // ---- filtry
  const games = GAMES.filter((g) => base.some((i) => i.gameId === g.id));
  const langs = [...new Set(base.map((i) => i.lang))].sort((a, b) => CARD_LANGS.indexOf(a) - CARD_LANGS.indexOf(b));
  const srcs = shop ? [...new Set(base.map((i) => i.src))] : [];
  const flip = (k: keyof F, v: string) => setF((x) => { const s = new Set(x[k]); if (s.has(v)) s.delete(v); else s.add(v); return { ...x, [k]: s }; });
  const op = (k: keyof F, v: string, l: React.ReactNode) => (
    <button key={v} type="button" className={`fop${f[k].has(v) ? ' on' : ''}`} onClick={() => flip(k, v)}>{l}</button>
  );
  const LOCG = new Map<string, number>(), LOCF = new Map<string, number>();
  base.forEach((i) => {
    if (!i.loc) { LOCG.set('—', (LOCG.get('—') ?? 0) + i.have); return; }
    const g = locOf(i); LOCG.set(g, (LOCG.get(g) ?? 0) + i.have); LOCF.set(i.loc, (LOCF.get(i.loc) ?? 0) + i.have);
  });
  // Umístění ve filtru: posuvný seznam všech míst se zaškrtáváním, hledání zúží seznam (i na pozice).
  const fqq = fq.trim().toLowerCase();
  const czs = (x: [string, number], y: [string, number]) => x[0].localeCompare(y[0], 'cs', { numeric: true });
  const lops: [string, number][] = fqq
    ? [...[...LOCG].filter(([k]) => k !== '—'), ...[...LOCF].filter(([k]) => k.includes(' · '))].filter(([k]) => k.toLowerCase().includes(fqq)).sort(czs)
    : [...(LOCG.get('—') ? [['—', LOCG.get('—')!] as [string, number]] : []), ...[...LOCG].filter(([k]) => k !== '—').sort(czs)];
  const pills: [React.ReactNode, () => void, string][] = [
    ...[...f.g].map((v) => [<><i style={{ '--c': `var(--game-${v})` } as React.CSSProperties} />{getGame(v)?.name}</>, () => flip('g', v), `g${v}`] as [React.ReactNode, () => void, string]),
    ...[...f.c].map((v) => [<><b>Stav</b> {v}</>, () => flip('c', v), `c${v}`] as [React.ReactNode, () => void, string]),
    ...[...f.l].map((v) => [<><b>Jazyk</b> {langCode(v)}</>, () => flip('l', v), `l${v}`] as [React.ReactNode, () => void, string]),
    ...[...f.s].map((v) => [<><b>Zdroj</b> {SRC[v]?.[1] ?? v}</>, () => flip('s', v), `s${v}`] as [React.ReactNode, () => void, string]),
    ...[...f.p].map((v) => [<><b>Místo</b> {v === '—' ? 'bez umístění' : v}</>, () => flip('p', v), `p${v}`] as [React.ReactNode, () => void, string]),
    ...(forSale ? [[forSale === 'on' ? 'Na prodej' : shop ? 'Nevystavené' : 'Ve sbírce', () => setForSale(''), 'sale'] as [React.ReactNode, () => void, string]] : []),
    ...(attn ? [[<><i className="adot" />Potřebuje pozornost</>, () => setAttn(false), 'attn'] as [React.ReactNode, () => void, string]] : []),
    ...(dup ? [['Duplicity', () => setDup(false), 'dup'] as [React.ReactNode, () => void, string]] : []),
    ...(old ? [['Leží přes 60 dní', () => setOld(false), 'old'] as [React.ReactNode, () => void, string]] : []),
  ];
  const filters = (
    <div className="bar">
      <span className="fwrap" ref={fwrap}>
        <button type="button" className={`fbtn${fp ? ' open' : ''}${nF ? ' act' : ''}`} onClick={() => setFp(!fp)}>{Ico.filter}Filtry{nF ? <span className="bd">{nF}</span> : null}</button>
        {fp ? (
          <div className="fpop">
            {games.length ? <div className="fsec"><h6>Hra</h6><div className="fops">{games.map((g) => op('g', g.id, <><i style={{ '--c': g.dot } as React.CSSProperties} />{g.name}</>))}</div></div> : null}
            <div className="fsec"><h6>Stav</h6><div className="fops">{['NM', 'EX', 'GD', 'LP', 'PL'].map((c) => op('c', c, c))}</div></div>
            {sale ? null : (
              <div className="fsec"><h6>{shop ? 'Prodej' : 'Nabídka'}</h6><div className="fops">
                {([['', 'Vše'], ['on', shop ? 'Na prodej' : 'Nabízím'], ['off', shop ? 'Nevystavené' : 'Ve sbírce']] as ['' | 'on' | 'off', string][]).map(([v, l]) => (
                  <button key={v} type="button" className={`fop${forSale === v ? ' on' : ''}`} onClick={() => setForSale(v)}>{l}</button>
                ))}
              </div></div>
            )}
            {langs.length ? <div className="fsec"><h6>Jazyk</h6><div className="fops">{langs.map((l) => op('l', l, langCode(l)))}</div></div> : null}
            {srcs.length ? <div className="fsec"><h6>Zdroj</h6><div className="fops">{srcs.map((k) => op('s', k, SRC[k]?.[1] ?? k))}</div></div> : null}
            <div className="fsec"><h6>Umístění</h6>
              {f.p.size ? <div className="ftags">{[...f.p].map((v) => <span key={v} className="fpill">{v === '—' ? 'Bez umístění' : v}<button type="button" className="xx" onClick={() => flip('p', v)} title="Odebrat">×</button></span>)}</div> : null}
              <button type="button" className={`fsel${locOpen ? ' open' : ''}`} onClick={() => { setLocOpen(!locOpen); setFq(''); }}>{f.p.size ? 'Přidat další umístění' : 'Vybrat umístění'}{Ico.chev}</button>
              {locOpen ? <div className="fsdd">
                <label className="floc">{Ico.s}<input autoFocus placeholder="Hledat místo nebo pozici" value={fq} onChange={(e) => setFq(e.target.value)} autoComplete="off" /></label>
                <div className="flist">
                  {lops.length ? lops.map(([k, c]) => (
                    <button key={k} type="button" className={f.p.has(k) ? 'on' : ''} onClick={() => flip('p', k)}>
                      <span className={`cb${f.p.has(k) ? ' on' : ''}`} />{k === '—' ? 'Bez umístění' : k}<em>{nf(c)}</em>
                    </button>))
                    : <span className="fnone">Žádné místo neodpovídá</span>}
                </div>
              </div> : null}
            </div>
            {shop ? (
              <button type="button" className="frow" onClick={() => setAttn(!attn)}>
                <span><i className="adot" />Jen co potřebuje pozornost <em>{nAttn}</em></span><span className={`fsw${attn ? ' on' : ''}`} />
              </button>
            ) : null}
            <div className="ffoot">
              <button type="button" className="btn sm g" disabled={!nF} onClick={resetF}>Vymazat vše</button>
              <button type="button" className="btn sm p" onClick={() => setFp(false)}>Zobrazit {plA(visible.length)}</button>
            </div>
          </div>
        ) : null}
      </span>
      {pills.map(([h, clr, k]) => <span key={k} className="fpill">{h}<button type="button" className="xx" onClick={clr} title="Zrušit">×</button></span>)}
      {nF > 1 ? <button type="button" className="fclr" onClick={resetF}>Vymazat</button> : null}
      <label className="search">{Ico.s}<input placeholder="Karta, sada, číslo, umístění" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <span className="view">
        <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title="Řádky s obrázky">{Ico.list}</button>
        <button type="button" className={view === 'text' ? 'on' : ''} onClick={() => setView('text')} title="Jen řádky">{Ico.text}</button>
      </span>
    </div>
  );

  // ---- buňky
  const itags = (i: Item) => {
    const r = issues(i, shop);
    const tb = !shop && i.trade ? <span className="trdb">Výměna {i.trade}×</span> : null;
    if (!r.length) return tb;
    const lz = r.find((x) => x.startsWith('Leží')); const first = lz ?? r[0]; const rest = r.filter((x) => x !== first);
    return <>{tb}<span className="iss">{first}</span>{rest.length ? <span className="iss more" title={rest.join(' · ')}>+{rest.length}</span> : null}
      {lz && canPrice ? <button type="button" className="disb" onClick={(e) => { e.stopPropagation(); setSel(new Set([i.id])); setModal('price'); }}><span className="dl">Nabídnout slevu</span><span className="ds">Sleva</span></button> : null}</>;
  };
  const openPop = (k: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!needReady(true)) return;
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPop({ k, x: Math.max(8, Math.min(window.innerWidth - 308, b.left + b.width / 2 - 150)), y: b.bottom + 6 });
  };
  const saleCell = (list: Item[], k: string) => {
    const have = list.reduce((s, x) => s + x.have, 0), s = list.reduce((a, x) => a + x.sale, 0);
    if (list.every((x) => x.locked)) return <span className="spill add" style={{ cursor: 'default' }}><DashBorder />Skryto podporou</span>;
    if (!s) return <button type="button" className="spill add" onClick={(e) => openPop(k, e)}><DashBorder />+ Prodávat</button>;
    return (
      <span className="spill" onClick={(e) => e.stopPropagation()}>
        <button type="button" title="Méně" disabled={pending} onClick={() => (list.length > 1 ? gstep(list, -1) : step(list[0], -1))}>−</button>
        <button type="button" className="sv" title="Stáhnout z prodeje" disabled={pending} onClick={() => stop(list)}><b>{nf(s)}</b><small>z {nf(have)}</small></button>
        <button type="button" title="Více" disabled={pending || s >= have} onClick={() => (list.length > 1 ? gstep(list, 1) : step(list[0], 1))}>+</button>
        <i style={{ '--w': `${(s / have) * 100}%` } as React.CSSProperties} />
      </span>
    );
  };
  const priceEdit = (list: Item[], k: string, init: number | null, hint: string) => (
    <span className="pr pedit" onClick={(e) => e.stopPropagation()}>
      <span className="pebox">
        <input className="pin" autoFocus defaultValue={init ?? ''} inputMode="numeric"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEdit(null);
            if (e.key === 'Enter') savePrice(list, Number((e.target as HTMLInputElement).value.replace(/\D/g, '')));
          }}
          onBlur={() => setEdit((x) => (x === k ? null : x))} /><em>Kč</em>
      </span>
      <small>{hint}</small>
    </span>
  );
  const priceCell = (i: Item) => {
    if (edit === i.id) return priceEdit([i], i.id, i.price ?? i.market, 'Enter uložit · Esc zpět');
    return (
      <span className="pr pdbl" title="Kliknutím upravíte cenu" onClick={(e) => { e.stopPropagation(); if (canPrice && !i.locked) setEdit(i.id); }}>
        {i.price == null ? <b style={{ color: 'var(--ink-muted)' }}>—</b> : <b>{kc(i.price)}</b>}<small>trh {kc(i.market)}</small>
      </span>
    );
  };
  const cb = (on: boolean, mid: boolean, fn: () => void, label: string) => (
    <button type="button" className={`cb${on ? ' on' : mid ? ' mid' : ''}`} aria-label={label} onClick={(e) => { e.stopPropagation(); fn(); }} />
  );

  const trow = (i: Item, child?: 1 | 2) => (
    <tr key={i.id} className={`${sel.has(i.id) ? 'sel' : ''} ${i.sale ? 'fsale' : ''} ${child ? 'child' : ''} ${child === 2 ? 'last' : ''}`} onClick={() => setOpen(i.id)}>
      <td style={{ width: 40 }}>{cb(sel.has(i.id), false, () => toggle([i.id], !sel.has(i.id)), `Vybrat ${i.name}`)}</td>
      <td>
        {child ? (
          <div className="cn sub"><span className="tree" /><span><b>{COND_FULL[i.cond] ?? i.cond}</b><small className="lng">{LANG_FULL[i.lang] ?? i.lang}</small>{itags(i) ? <span className="isl">{itags(i)}</span> : null}</span></div>
        ) : (
          <div className={`cn${issues(i, shop).length ? ' hasiss' : ''}`}>
            {i.img ? <img src={i.img} alt="" /> : <img alt="" />}
            <span><b>{i.name}</b><span className="mt"><small className="mono">{i.set}</small>{i.game ? <small> · {i.game}</small> : null}</span>{itags(i) ? <span className="isl">{itags(i)}</span> : null}</span>
          </div>
        )}
      </td>
      <td><span className={`cond ${i.cond}`}>{i.cond}</span></td>
      <td><span className="lang">{langCode(i.lang)}</span></td>
      <td className="c mono">{nf(i.have)}</td>
      <td className="sc">{saleCell([i], i.id)}</td>
      <td className="c pcell">{priceCell(i)}</td>
      {shop ? <td><span className={`src ${SRC[i.src]?.[0] ?? 'R'}`}>{SRC[i.src]?.[1] ?? i.src}</span></td> : null}
      <td className="c"><span className="loc">{i.loc || '—'}</span></td>
      <td className="r"><button type="button" className="more" onClick={(e) => { e.stopPropagation(); setOpen(i.id); }} aria-label="Detail">{Ico.dots}</button></td>
    </tr>
  );
  const grow = (g: Item[]) => {
    const i = g[0], k = i.key, op_ = exp.has(k) || attn;
    const ids = g.filter((x) => !x.locked).map((x) => x.id);
    const gAll = ids.length > 0 && ids.every((id) => sel.has(id)), gSome = ids.some((id) => sel.has(id));
    const have = g.reduce((a, x) => a + x.have, 0), s = g.reduce((a, x) => a + x.sale, 0);
    const ps = g.filter((x) => x.price != null).map((x) => x.price!), lo = Math.min(...ps), hi = Math.max(...ps);
    const pr = edit === `g:${k}` ? priceEdit(g, `g:${k}`, ps.length ? lo : i.market, `Přepíše cenu všem ${g.length} variantám`)
        : <span className="pr pdbl" title="Kliknutím nastavíte cenu všem variantám" onClick={(e) => { e.stopPropagation(); if (canPrice) setEdit(`g:${k}`); }}>
          {ps.length ? <><b>{lo === hi ? kc(lo) : `od ${kc(lo)}`}</b>{lo === hi ? null : <small>do {kc(hi)}</small>}</> : <b style={{ color: 'var(--ink-muted)' }}>—</b>}
        </span>;
    const conds = [...new Set(g.map((x) => x.cond))];
    const L = [...new Set(g.map((x) => langCode(x.lang)))];
    const langs_ = L.length > 3 ? `${L.slice(0, 2).join(' · ')} +${L.length - 2}` : L.join(' · ');
    const locs = [...new Set(g.map((x) => x.loc || '—'))];
    const us = [...new Set(g.map((x) => x.src))];
    return [
      <tr key={`g${k}`} className={`grp${op_ ? ' open' : ''}${gAll ? ' sel' : ''}${s ? ' fsale' : ''}`} onClick={() => setExp((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>
        <td style={{ width: 40 }}>{cb(gAll, gSome, () => toggle(ids, !gAll), `Vybrat ${i.name}`)}</td>
        <td>
          <div className="cn">
            {i.img ? <img src={i.img} alt="" /> : <img alt="" />}
            <span><b>{i.name}</b><span className="mt"><small className="mono">{i.set}</small>{i.game ? <small> · {i.game}</small> : null}</span>
              {!shop && g.some((x) => x.trade) ? <span className="isl"><span className="trdb">Výměna {g.reduce((a, x) => a + x.trade, 0)}×</span></span> : null}</span>
            <span className="gtag"><i className={`adot${g.some((x) => issues(x, shop).length) ? '' : ' off'}`} />{g.length} {g.length < 5 ? 'varianty' : 'variant'} {Ico.chev}</span>
          </div>
        </td>
        <td><span className="conds">{conds.map((c) => <span key={c} className={`cond ${c}`}>{c}</span>)}</span></td>
        <td><span className="lang">{langs_}</span></td>
        <td className="c mono">{nf(have)}</td>
        <td className="sc">{saleCell(g, `g:${k}`)}</td>
        <td className="c pcell">{pr}</td>
        {shop ? <td>{us.length > 1 ? <span className="src">{us.length} zdroje</span> : <span className={`src ${SRC[us[0]]?.[0] ?? 'R'}`}>{SRC[us[0]]?.[1] ?? us[0]}</span>}</td> : null}
        <td className="c"><span className="loc">{locs.length > 1 ? `${locs.length} místa` : locs[0]}</span></td>
        <td className="r"><span className="more" title={op_ ? 'Sbalit' : 'Rozbalit varianty'}><i className={`gchev${op_ ? ' op' : ''}`} /></span></td>
      </tr>,
      ...(op_ ? g.map((x, j) => trow(x, j === g.length - 1 ? 2 : 1)) : []),
    ];
  };

  const pager = (() => {
    if (NP <= 1) return <span />;
    const last = Math.min(NP, pg + more);
    const set = new Set([1, NP]); for (let x = pg; x <= last; x++) set.add(x);
    let a = [...set].sort((x, y) => x - y);
    a = a.flatMap((x, k) => (k && x - a[k - 1] === 2 ? [x - 1, x] : [x]));
    const out: React.ReactNode[] = []; let prev = 0;
    a.forEach((x) => {
      if (x - prev > 1) out.push(<span key={`d${x}`} className="pgd">…</span>);
      out.push(<button key={x} type="button" className={`pgn${x >= pg && x <= last ? ' on' : ''}`} onClick={() => { setPage(x); setMore(0); }}>{x}</button>);
      prev = x;
    });
    return (
      <div className="pager">
        <button type="button" className="pgn ar" disabled={pg <= 1} onClick={() => { setPage(pg - 1); setMore(0); }} title="Předchozí">‹</button>
        <span className="pnums">{out}</span>
        <button type="button" className="pgn ar" disabled={last >= NP} onClick={() => { setPage(last + 1); setMore(0); }} title="Další stránka">›</button>
      </div>
    );
  })();
  const th = (label: string, k: Sort | '', cls = '') => (
    <th className={`${cls} ${k ? 'sort' : ''} ${sort === k ? 'sorted' : ''}`} onClick={k ? () => setSort(sort === k ? 'chg' : k) : undefined}>{label}</th>
  );

  const table = !visible.length ? (
    <div className="tbl"><div className="none">{all.length ? <>Nic tomu neodpovídá. <button type="button" className="btn sm" style={{ marginLeft: 8 }} onClick={resetF}>Zrušit filtry</button></> : `Ve ${shop ? 'skladu' : 'sbírce'} zatím nic není.`}</div></div>
  ) : (
    <div className={`tbl${view === 'text' ? ' txt' : ''}`}>
      <table>
        <thead><tr>
          <th style={{ width: 40 }}>{cb(allSel, someSel, () => toggle(filterIds, !allSel), `Vybrat všech ${filterIds.length} podle filtru`)}</th>
          {th('Karta', 'name')}{th('Stav', '')}{th('Jazyk', '')}{th('Mám', 'have', 'c')}{th('Na prodej', '', 'c')}{th('Cena', 'price', 'c')}
          {shop ? th('Zdroj', '', 'c') : null}{th('Umístění', '', 'c')}<th />
        </tr></thead>
        <tbody>{shown.flatMap((g) => (g.length === 1 ? [trow(g[0])] : grow(g)))}</tbody>
      </table>
      <div className="foot">
        <span className="fl">{groups.length ? nf(st + 1) : 0}–{nf(en)} z {nf(groups.length)} {fAny ? '(filtrováno)' : ''} · {{ chg: 'naposledy změněné', name: 'podle názvu', have: 'podle počtu', price: 'podle ceny' }[sort]}</span>
        {pager}
        <span className="fr">{en < groups.length ? <button type="button" className="btn sm" onClick={() => setMore(more + 1)}>Zobrazit dalších {Math.min(PG, groups.length - en)}</button> : null}</span>
      </div>
    </div>
  );

  // ---- popover Prodávat
  const popList = pop ? (pop.k.startsWith('g:') ? groups.find((g) => g[0].key === pop.k.slice(2)) ?? [] : [byId.get(pop.k)!].filter(Boolean)) : [];

  const n = selItems.length;
  const current = open ? byId.get(open) ?? null : null;

  return (
    <>
      {strip}
      {attnNote}
      {filters}
      {table}

      {pop && popList.length ? <SellPop list={popList} shop={shop} x={pop.x} y={pop.y} onClose={() => setPop(null)}
        onOk={(rowsSet, text) => { setPop(null); bulk(rowsSet, text, text); }} /> : null}

      {n ? (
        <div className="bulk">
          <button type="button" className="cb on" onClick={() => setSel(new Set())} title="Zrušit výběr" />
          <span className="cnt">{nf(n)} {n === 1 ? 'vybraná' : n < 5 ? 'vybrané' : 'vybraných'}</span>
          <div className="bm">
            {canPrice ? <button type="button" className="btn sm p keep" onClick={() => setModal('sell')}>{shop ? 'Dát do prodeje' : 'Nabídnout'}</button> : null}
            {shop && canPrice ? <button type="button" className="btn sm keep" onClick={() => setModal('price')}>Upravit ceny</button> : null}
            {shop ? null : <button type="button" className="btn sm keep" disabled={pending} onClick={() => run(() => stockChange(selItems.map((x) => x.id), 'trade_all'), `Na výměnu: ${pl1(n)}`)}>Na výměnu</button>}
            <button type="button" className="btn sm" onClick={() => setModal('attr')}>Stav a jazyk</button>
            <button type="button" className="btn sm" onClick={() => setModal('loc')}>Umístění</button>
            {shop ? <a className="btn sm" href={`/prodat/stitky?ids=${selItems.slice(0, 200).map((x) => x.id).join(',')}`} target="_blank" rel="noreferrer">Štítky</a> : null}
            <button type="button" className="btn sm" onClick={() => setModal('export')}>Exportovat</button>
            {canAdd ? <button type="button" className="btn sm g d" onClick={() => setModal('del')}>Odebrat</button> : null}
          </div>
          <button type="button" className="btn sm bo" onClick={() => setModal('bmore')}>{Ico.dots}</button>
          <button type="button" className="x" onClick={() => setSel(new Set())} title="Zavřít">{Ico.x}</button>
        </div>
      ) : null}

      {modal === 'sell' ? <SellModal items={selItems} shop={shop} onClose={() => setModal(null)}
        onOk={(list, text) => { if (!needReady(true)) return; setModal(null); bulk(list, text, text, 'stock', () => setSel(new Set())); }} /> : null}
      {modal === 'price' ? <PriceModal items={selItems} onClose={() => setModal(null)}
        onOk={(list, text) => { setModal(null); bulk(list, text, text, 'price'); }} /> : null}
      {modal === 'attr' ? <AttrModal n={n} onClose={() => setModal(null)}
        onOk={(c, l) => { setModal(null); bulk(selItems.map((x) => ({ id: x.id, ...(c ? { condition: c } : {}), ...(l ? { language: l } : {}) })), `Stav a jazyk · ${pl1(n)}`, 'Stav a jazyk uloženy'); }} /> : null}
      {modal === 'loc' ? <LocModal n={n} places={[...LOCG].filter(([k]) => k !== '—').sort((a, b) => b[1] - a[1]).map(([k]) => k)} onClose={() => setModal(null)}
        onOk={(v) => { setModal(null); run(() => stockChange(selItems.map((x) => x.id), 'location', v), 'Umístění uloženo'); }} /> : null}
      {modal === 'del' ? (
        <Modal title={`Odebrat ${plA(n)}?`} onClose={() => setModal(null)} foot={<>
          <button type="button" className="btn" onClick={() => setModal(null)}>Zrušit</button>
          <button type="button" className="btn p" style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#2a0b09' }}
            onClick={() => { setModal(null); run(() => stockChange(selItems.map((x) => x.id), 'remove'), `Odebráno: ${pl1(n)}`, () => setSel(new Set())); }}>Odebrat</button>
        </>}>
          <p style={{ margin: 0, color: 'var(--ink-muted)' }}>Karty zmizí ze {shop ? 'skladu i z prodeje' : 'sbírky i z nabídky'}. Odebrání už vrátit nejde.</p>
        </Modal>
      ) : null}
      {modal === 'export' ? <ExportModal shop={shop} selected={selItems.map((x) => x.id)} filtered={visible.map((x) => x.id)} total={all.length} onClose={() => setModal(null)} /> : null}
      {modal === 'bmore' ? (
        <Modal title="Další akce" onClose={() => setModal(null)} foot={<button type="button" className="btn" onClick={() => setModal(null)}>Zavřít</button>}>
          <div className="opt">
            {((shop ? [['price', 'Upravit ceny'], ['attr', 'Stav a jazyk'], ['loc', 'Umístění'], ['export', 'Exportovat'], ['del', 'Odebrat']] : [['attr', 'Stav a jazyk'], ['loc', 'Umístění'], ['export', 'Exportovat'], ['del', 'Odebrat']]) as [BulkModal, string][])
              .map(([k, l]) => <label key={k} onClick={() => setModal(k)} style={k === 'del' ? { color: 'var(--danger)' } : undefined}><span>{l}</span></label>)}
          </div>
        </Modal>
      ) : null}

      {current ? <Drawer key={current.id} i={current} places={[...LOCG].filter(([k]) => k !== '—').sort((a, b) => b[1] - a[1]).map(([k]) => k)} shop={shop} canPrice={canPrice} canAdd={canAdd} onClose={() => setOpen(null)}
        onDone={(r, text) => { done(r, text); if (!r.error) setOpen(null); }} /> : null}

      {toast ? <div className={`toast${toast.err ? ' err' : ''}`} role="status">{toast.t}{toast.undo ? <> · Vrátit to jde v Historii</> : null}</div> : null}
    </>
  );
}

/** Popover u „+ Prodávat“: kolik kusů a za kolik. */
function SellPop({ list, shop, x, y, onClose, onOk }: {
  list: Item[]; shop: boolean; x: number; y: number; onClose: () => void; onOk: (rows: BulkRow[], text: string) => void;
}) {
  const have = list.reduce((s, i) => s + i.have, 0);
  const first = list.find((i) => i.price != null) ?? list[0];
  const [qty, setQty] = useState(String(have));
  const [price, setPrice] = useState(String(first.price ?? first.market ?? ''));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => document.addEventListener('mousedown', h));
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [onClose]);
  const ok = () => {
    let left = Math.max(0, Math.min(have, Number(qty.replace(/\D/g, '')) || 0));
    const p = Number(price.replace(/\D/g, '')) || null;
    const rows: BulkRow[] = list.filter((i) => !i.locked).map((i) => {
      const s = Math.min(i.have, left); left -= s;
      return { id: i.id, quantity: s, keep_qty: i.have - s, ...(shop ? { price_czk: p } : i.price == null ? { price_czk: i.market ?? null } : {}) };
    });
    onOk(rows, `${list[0].name}: na prodej ${qty} z ${have}`);
  };
  return (
    <>
      <div className="pop" ref={ref} style={{ left: x, top: Math.min(y, window.innerHeight - 260) }} onClick={(e) => e.stopPropagation()}>
        <p className="lbl" style={{ margin: 0 }}>Kolik kusů prodat</p>
        <div className="inp"><input className="pin" value={qty} inputMode="numeric" autoFocus onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} /><em>z {have}</em></div>
        <div className="qk">
          <button type="button" onClick={() => setQty('1')}>1</button>
          {have > 3 ? <button type="button" onClick={() => setQty(String(Math.ceil(have / 2)))}>Polovinu</button> : null}
          <button type="button" onClick={() => setQty(String(Math.max(0, have - 1)))}>Nechat si 1</button>
          <button type="button" onClick={() => setQty(String(have))}>Všechny</button>
        </div>
        {shop ? <>
          <p className="lbl" style={{ margin: '4px 0 0' }}>Cena za kus</p>
          <div className="inp"><input className="pin" value={price} inputMode="numeric" onChange={(e) => setPrice(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} /><em>Kč · trh {kc(first.market)}</em></div>
        </> : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn sm g" onClick={onClose}>Zrušit</button>
          <button type="button" className="btn sm p" onClick={ok}>{shop ? 'Prodávat' : 'Nabídnout'}</button>
        </div>
      </div>
    </>
  );
}

function SellModal({ items, shop, onClose, onOk }: { items: Item[]; shop: boolean; onClose: () => void; onOk: (rows: BulkRow[], text: string) => void }) {
  const [ms, setMs] = useState<'all' | 'keep' | 'n'>('all');
  const [n, setN] = useState('1');
  const [pm, setPm] = useState<'mk' | 'mk5' | 'own'>('mk');
  const [own, setOwn] = useState('');
  const apply = () => {
    const rows: BulkRow[] = items.map((i) => {
      const s = ms === 'all' ? i.have : ms === 'keep' ? Math.max(0, i.have - 1) : Math.min(i.have, Number(n) || 0);
      const p = i.price != null ? undefined : pm === 'own' ? (Number(own) || null) : i.market ? Math.max(1, Math.round(i.market * (pm === 'mk5' ? 0.95 : 1))) : null;
      return { id: i.id, quantity: s, keep_qty: i.have - s, ...(p !== undefined ? { price_czk: p } : {}) };
    });
    onOk(rows, `${shop ? 'Na prodej' : 'Nabídnuto'} · ${pl1(items.length)}`);
  };
  return (
    <Modal title={`${shop ? 'Dát do prodeje' : 'Nabídnout'}: ${pl1(items.length)}`} onClose={onClose} foot={<>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
      <button type="button" className="btn p" onClick={apply}>{shop ? 'Dát do prodeje' : 'Nabídnout'}</button>
    </>}>
      <div className="opt">
        {([['all', 'Všechny kusy', 'Každá karta celým počtem, který máte'], ['keep', 'Nechat si 1 kus', 'Hodí se pro sběratele a pro vitrínu'], ['n', 'Přesný počet', 'Stejný počet u každé vybrané karty']] as const).map(([k, t, d]) => (
          <label key={k} className={ms === k ? 'on' : ''} onClick={() => setMs(k)}><span className="rd" /><span>{t}<small>{d}</small></span></label>
        ))}
      </div>
      {ms === 'n' ? <div className="f"><label>Kolik kusů</label><div className="inp"><input value={n} inputMode="numeric" onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} /><em>ks</em></div></div> : null}
      <div className="f"><label>Cena u karet bez ceny</label>
        <Seg value={pm} onChange={setPm} options={[['mk', 'Tržní cena'], ['mk5', 'Tržní −5 %'], ['own', 'Zadám sám']]} />
      </div>
      {pm === 'own' ? <div className="inp"><input value={own} inputMode="numeric" placeholder="Cena za kus" onChange={(e) => setOwn(e.target.value.replace(/\D/g, ''))} /><em>Kč</em></div> : null}
    </Modal>
  );
}

function PriceModal({ items, onClose, onOk }: { items: Item[]; onClose: () => void; onOk: (rows: BulkRow[], text: string) => void }) {
  const [mode, setMode] = useState<'pct' | 'kc' | 'mk'>('pct');
  const [dir, setDir] = useState<'-1' | '1'>('-1');
  const [val, setVal] = useState('5');
  const [round, setRound] = useState<'9' | '1'>('9');
  const [floor, setFloor] = useState('10');
  const calc = (i: Item) => {
    const b = i.price ?? i.market; if (b == null) return null;
    const v0 = Number(val) || 0, d = Number(dir);
    let v = mode === 'pct' ? b * (1 + (d * v0) / 100) : mode === 'kc' ? b + d * v0 : (i.market ?? b) * (1 - v0 / 100);
    v = Math.max(1, Math.round(v));
    if (round === '9' && v > 20) v = Math.floor(v / 10) * 10 + 9;
    if (i.buy && floor) v = Math.max(v, Math.round(i.buy * (1 + Number(floor) / 100)));
    return v;
  };
  const rows = items.map((i) => [i, calc(i)] as const);
  return (
    <Modal title={`Upravit ceny: ${pl1(items.length)}`} onClose={onClose} foot={<>
      <span className="note">Změnu půjde vrátit v Historii.</span>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
      <button type="button" className="btn p" onClick={() => onOk(rows.filter(([, v]) => v != null).map(([i, v]) => ({ id: i.id, price_czk: v })), `Úprava cen · ${pl1(items.length)}`)}>Použít na {plA(items.length)}</button>
    </>}>
      <div className="grid2">
        <div className="f"><label>Jak</label><Seg value={mode} onChange={setMode} options={[['pct', 'O procenta'], ['kc', 'O korun'], ['mk', 'Podle trhu']]} /></div>
        <div className="f"><label>{mode === 'mk' ? 'Pod tržní cenou o' : 'Kolik'}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {mode !== 'mk' ? <Seg value={dir} onChange={setDir} options={[['-1', 'Zlevnit'], ['1', 'Zdražit']]} /> : null}
            <div className="inp" style={{ flex: 1 }}><input value={val} inputMode="numeric" onChange={(e) => setVal(e.target.value.replace(/\D/g, ''))} /><em>{mode === 'kc' ? 'Kč' : '%'}</em></div>
          </div>
        </div>
      </div>
      <div className="grid2">
        <div className="f"><label>Zaokrouhlit</label><Seg value={round} onChange={setRound} options={[['9', 'Na …9 Kč'], ['1', 'Na celé Kč']]} /></div>
        <div className="f"><label>Nejnižší cena</label><div className="inp"><span style={{ font: '500 13px var(--fs)', color: 'var(--ink-muted)' }}>nákupní +</span><input value={floor} inputMode="numeric" onChange={(e) => setFloor(e.target.value.replace(/\D/g, ''))} /><em>% · pojistka</em></div></div>
      </div>
      <div>
        <p className="lbl">Náhled</p>
        <div className="prev">
          <div><span>Karta</span><span style={{ textAlign: 'right' }}>Teď</span><span /><span style={{ textAlign: 'right' }}>Nově</span></div>
          {rows.slice(0, 6).map(([i, v]) => (
            <div key={i.id}><span>{i.name} <small className="mono" style={{ color: 'var(--ink-muted)' }}>{i.set}</small></span><span className="o">{kc(i.price ?? i.market)}</span><span className="ar">→</span><span className="nw">{kc(v)}</span></div>
          ))}
          {items.length > 6 ? <div><span style={{ color: 'var(--ink-muted)' }}>… a dalších {nf(items.length - 6)} karet</span><span /><span /><span /></div> : null}
        </div>
      </div>
    </Modal>
  );
}

function AttrModal({ n, onClose, onOk }: { n: number; onClose: () => void; onOk: (c: string, l: string) => void }) {
  const [c, setC] = useState('');
  const [l, setL] = useState('');
  return (
    <Modal title={`Stav a jazyk: ${pl1(n)}`} onClose={onClose} foot={<>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
      <button type="button" className="btn p" disabled={!c && !l} onClick={() => onOk(c, l)}>Uložit</button>
    </>}>
      <div className="f"><label>Stav</label><Seg value={c} onChange={setC} options={[['', 'Neměnit'], ['NM', 'NM'], ['EX', 'EX'], ['GD', 'GD'], ['LP', 'LP'], ['PL', 'PL']]} /></div>
      <div className="f"><label>Jazyk</label><Seg value={l} onChange={setL} options={[['', 'Neměnit'], ['en', 'EN'], ['de', 'DE'], ['ja', 'JP'], ['fr', 'FR'], ['it', 'IT']]} /></div>
    </Modal>
  );
}

/** Pozice nesmí znít jako některé místo (aby nevznikl zmatek). */
const posClash = (pos: string, places: string[]) => { const p = pos.trim().toLowerCase(); return !!p && places.some((l) => l.toLowerCase() === p); };
const PosClash = ({ pos }: { pos: string }) => <small style={{ color: 'var(--warn,#f0a24a)', fontSize: 12, display: 'block', marginTop: 6 }}>„{pos.trim()}“ je název místa. Zvolte ho nahoře jako místo, nebo pozici pojmenujte jinak.</small>;

/** Výběr místa: hledání + posuvný seznam všech míst (jedno vybrané), nové místo se přidá přímo z hledání. */
function PlacePicker({ places, value, onPick }: { places: string[]; value: string; onPick: (v: string) => void }) {
  const [q, setQ] = useState('');
  const qq = q.trim().toLowerCase();
  const list = places.filter((l) => !qq || l.toLowerCase().includes(qq)).sort((a, b) => a.localeCompare(b, 'cs', { numeric: true }));
  if (value && !places.includes(value)) list.unshift(value);
  const exact = places.find((l) => l.toLowerCase() === qq);
  const add = () => { onPick(q.trim()); setQ(''); };
  return <>
    <div className="floc">{Ico.s}<input value={q} maxLength={40} placeholder="Najít nebo přidat místo" autoComplete="off"
      onChange={(e) => setQ(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && qq) { e.preventDefault(); if (exact) { onPick(exact); setQ(''); } else add(); } }} /></div>
    <div className="flist">
      {list.map((l) => <button key={l} type="button" className={value === l ? 'on' : ''} onClick={() => onPick(value === l ? '' : l)}>
        <span className={`cb rd${value === l ? ' on' : ''}`} />{l}{!places.includes(l) ? <em>nové</em> : null}</button>)}
      {qq && !exact ? <button type="button" className="add" onClick={add}>+ Přidat místo „{q.trim()}“</button> : null}
      {!list.length && !qq ? <span className="fnone">Zatím žádné místo. Napište název a přidejte ho.</span> : null}
    </div>
  </>;
}

function LocModal({ n, places, onClose, onOk }: { n: number; places: string[]; onClose: () => void; onOk: (v: string) => void }) {
  const [cur, setCur] = useState(places[0] ?? '');
  const [pos, setPos] = useState('');
  const v = cur.trim() ? (pos.trim() && pos.trim() !== cur.trim() ? `${cur.trim()} · ${pos.trim()}` : cur.trim()) : '';
  return (
    <Modal title={`Umístění: ${pl1(n)}`} onClose={onClose} foot={<>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
      <button type="button" className="btn p" disabled={!v || posClash(pos, places)} onClick={() => onOk(v)}>Uložit</button>
    </>}>
      <div className="f"><label>Umístění</label>
        <PlacePicker places={places} value={cur} onPick={(v) => { if (v !== cur && (v === '' || places.includes(v))) setPos(''); setCur(v); }} />
        <small style={{ color: 'var(--ink-muted)', fontSize: 12, display: 'block', marginTop: 6 }}>Místa a skupiny spravujete v Inventuře → Upravit místa.</small>
      </div>
      {cur.trim() ? <div className="f"><label>Pozice v umístění <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>(nepovinné)</span></label>
        <div className="inp"><input value={pos} maxLength={40} style={{ font: '500 14px var(--fs)' }} placeholder="Např. 04, strana 3, řada 2" onChange={(e) => setPos(e.target.value)} /></div>
        {posClash(pos, places) ? <PosClash pos={pos} /> : null}
        <small style={{ color: 'var(--ink-muted)', fontSize: 12, display: 'block', marginTop: 6 }}>Pozice pomáhá při vychystávání. Když ji nevyplníte, bude jen „{cur.trim()}“.</small>
      </div> : null}
    </Modal>
  );
}

function Spark({ v, down }: { v: number[]; down: boolean }) {
  if (v.length < 2) return null;
  const mx = Math.max(...v), mn = Math.min(...v);
  const pts = v.map((y, k) => `${((k * 300) / (v.length - 1)).toFixed(1)} ${(40 - ((y - mn) / (mx - mn || 1)) * 32).toFixed(1)}`);
  const c = down ? 'var(--danger)' : 'var(--accent)';
  return (
    <svg className="spark" viewBox="0 0 300 44" preserveAspectRatio="none">
      <path d={`M${pts.join(' L')}`} fill="none" stroke={c} strokeWidth="2" />
      <path d={`M${pts.join(' L')} V44 H0Z`} fill={`color-mix(in srgb,${c} 12%,transparent)`} />
    </svg>
  );
}

/** Detail karty (šuplík vpravo) podle prototypu. */
function Drawer({ i, places, shop, canPrice, canAdd, onClose, onDone }: {
  i: Item; places: string[]; shop: boolean; canPrice: boolean; canAdd: boolean; onClose: () => void; onDone: (r: { error?: string }, text: string) => void;
}) {
  const [have, setHave] = useState(i.have);
  const [sale, setSale] = useState(i.sale);
  const [trade, setTrade] = useState(i.trade);
  const [price, setPrice] = useState(i.price != null ? String(i.price) : '');
  const [cond, setCond] = useState(i.cond);
  const [lang, setLang] = useState(i.lang);
  // Umístění = místo (výběr z existujících, nebo nové) + nepovinná pozice v něm.
  const [loc0, pos0] = (() => { const [a, ...b] = (i.loc ?? '').split(' · '); return [a ?? '', b.join(' · ')]; })();
  const [place, setPlace] = useState(loc0);
  const [pos, setPos] = useState(pos0 === loc0 ? '' : pos0);
  const loc = place.trim() ? (pos.trim() && pos.trim() !== place.trim() ? `${place.trim()} · ${pos.trim()}` : place.trim()) : '';
  const [buy, setBuy] = useState(i.buy != null ? String(i.buy) : '');
  const [info, setInfo] = useState<CardInfo | null>(null);
  const [del, setDel] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => { cardInfo(i.id, i.key).then(setInfo).catch(() => undefined); }, [i.id, i.key]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const s = Math.min(sale, have);
  const stp = (label: string, v: number, set: (n: number) => void, max: number, on?: boolean) => (
    <div className="qbox"><small>{label}</small><div className="stp">
      <button type="button" disabled={i.locked || v <= 0} onClick={() => set(v - 1)}>−</button>
      <input className={`pin qin${on && v ? ' on' : ''}`} value={v} inputMode="numeric" disabled={i.locked} onChange={(e) => set(Math.min(max, Number(e.target.value.replace(/\D/g, '')) || 0))} />
      <button type="button" disabled={i.locked || v >= max} onClick={() => set(v + 1)}>+</button>
    </div></div>
  );
  const save = () => start(async () => {
    const p = price ? Number(price.replace(/\D/g, '')) : null;
    const r = await stockSet(i.id, i.name, {
      quantity: s, keep: have - s, trade: Math.min(trade, have), price: p,
      location: loc, buyPrice: buy ? Number(buy.replace(/\D/g, '')) : null,
    });
    if (!r.error && (cond !== i.cond || lang !== i.lang)) {
      const r2 = await stockBulkSet([{ id: i.id, condition: cond, language: lang }], `${i.name}: stav a jazyk`);
      if (r2.error) { onDone(r2, ''); return; }
    }
    onDone(r, `Uloženo: ${i.name}`);
  });
  const remove = () => start(async () => onDone(await stockChange([i.id], 'remove'), `Odebráno: ${i.name}`));
  const tr = info?.change;
  const lk = (k: string) => (k === i.lang || CARD_LANGS.slice(0, 4).includes(k));
  const langOpts = CARD_LANGS.filter(lk).slice(0, 5);
  return (
    <>
      <div className="dim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={i.name}>
        <div className="dh">
          {i.img ? <img src={i.img} alt="" /> : <img alt="" />}
          <div>
            <h2>{i.name}</h2>
            <p className="mono">{i.set}{i.game ? ` · ${i.game}` : ''}</p>
            {shop ? <p style={{ marginTop: 10 }}><span className={`src ${SRC[i.src]?.[0] ?? 'R'}`}>{SRC[i.src]?.[1] ?? i.src}</span></p> : null}
            {i.r.card ? <p style={{ marginTop: 10 }}><Link className="btn sm g" style={{ paddingLeft: 0 }} href={`/karty/${i.r.card.slug}`} target="_blank">Otevřít v katalogu ↗</Link></p> : null}
          </div>
          <button type="button" className="cls" onClick={onClose} aria-label="Zavřít">{Ico.x}</button>
        </div>
        <div className="db">
          {i.locked ? <p className="wsm" style={{ margin: 0 }}>{i.r.removed ? 'Nabídku odstranila podpora, upravit ji nejde.' : 'Nabídka je skrytá podporou, upravit ji nejde.'}</p> : null}
          <div>
            <p className="lbl">Počty</p>
            <div className="qty">
              {stp('Mám', have, (v) => { setHave(v); if (sale > v) setSale(v); }, 100000)}
              {canPrice ? stp(shop ? 'Na prodej' : 'Nabízím', s, setSale, have, true) : null}
              {shop ? null : stp('Na výměnu', Math.min(trade, have), setTrade, have, true)}
            </div>
            {shop ? null : <small className="wsm" style={{ display: 'block', marginTop: 6 }}>Kusy na výměnu uvidí ostatní na vašem profilu a můžou vám nabídnout svou kartu. Jeden kus může být na prodej i na výměnu zároveň.</small>}
          </div>
          <div>
            <p className="lbl">Cena</p>
            <div className="inp"><input value={price} disabled={i.locked || !canPrice} placeholder="Nastavit cenu" onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} /><em>Kč / ks</em></div>
            <div className="mk">Tržní cena <b>{kc(i.market)}</b>{tr != null ? <> <span className={`tr ${tr < 0 ? 'dn' : 'up'}`}>{tr > 0 ? '+' : tr < 0 ? '−' : ''}{Math.abs(tr)} %</span> za 30 dní</> : null}
              {i.market && canPrice ? <button type="button" onClick={() => setPrice(String(i.market))}>Použít tržní</button> : null}</div>
            {info ? <Spark v={info.series} down={(tr ?? 0) < 0} /> : null}
          </div>
          <div className="grid2">
            <div className="f"><label>Stav</label><Seg value={cond} onChange={setCond} options={['NM', 'EX', 'GD', 'LP', 'PL'].map((c) => [c, c] as [string, string])} /></div>
            <div className="f"><label>Jazyk</label><Seg value={lang} onChange={setLang} options={langOpts.map((l) => [l, langCode(l)] as [string, string])} /></div>
          </div>
          <div className="grid2">
            <div className="f"><label>Umístění</label>
              <PlacePicker places={places} value={place} onPick={(v) => { if (v !== place && (v === '' || places.includes(v))) setPos(''); setPlace(v); }} />
              {place.trim() ? <div className="inp" style={{ marginTop: 8 }}><input value={pos} maxLength={40} placeholder="Pozice, nepovinné (např. 04)" style={{ font: '500 14px var(--fs)' }} onChange={(e) => setPos(e.target.value)} /></div> : null}
              {place.trim() && posClash(pos, places) ? <PosClash pos={pos} /> : null}
            </div>
            <div className="f"><label>Nákupní cena</label><div className="inp"><input value={buy} placeholder="Za kolik jste ji koupili" style={{ fontSize: 14 }} onChange={(e) => setBuy(e.target.value.replace(/\D/g, ''))} /><em>Kč</em></div>
              {shop && i.buy && i.price != null ? (() => { const p = i.price - i.buy; return <div className={`pfd${p < 0 ? ' dn' : ''}`}>Zisk na kus <b>{p < 0 ? '−' : '+'}{kc(Math.abs(p))}</b> · {Math.round((p / i.buy) * 100)} %</div>; })() : null}
            </div>
          </div>
          <div>
            <p className="lbl">Historie karty</p>
            <div className="hist">
              {(info?.events ?? []).map((e) => (
                <div key={e.id}><span className="t">{new Date(e.at).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })}</span><span>{e.title}</span></div>
              ))}
              <div><span className="t">{new Date(i.r.createdAt).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })}</span><span>Přidáno: <b>{SRC[i.src]?.[1]?.toLowerCase() ?? 'ručně'}</b></span></div>
            </div>
          </div>
        </div>
        <div className="df">
          {canAdd && !i.locked ? (del
            ? <><button type="button" className="btn g" onClick={() => setDel(false)}>Ne</button><button type="button" className="btn g d" disabled={pending} onClick={remove}>Opravdu odebrat</button></>
            : <button type="button" className="btn g d" onClick={() => setDel(true)}>Odebrat</button>) : null}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>Zrušit</button>
          <button type="button" className="btn p" disabled={pending || i.locked || (!!place.trim() && posClash(pos, places))} onClick={save}>{pending ? 'Ukládám…' : 'Uložit'}</button>
        </div>
      </aside>
    </>
  );
}
