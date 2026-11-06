'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { fold } from '@/lib/import/columns';
import { stockUndo } from './actions';
import { historyCard, historyEvent, historyUndoPreview, watchSave, type CardHistory, type EventDetail, type UndoPreview } from './history-actions';
import type { HEntry, Period, WatchRules } from './history';

const S = (d: React.ReactNode, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{d}</svg>
);
/** Ikony Historie (stejné jako na plátně). */
export const HI = {
  sale: S(<><path d="M6 7h12l-1 13H7L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" /></>),
  add: S(<path d="M12 5v14M5 12h14" />),
  remove: S(<path d="M5 12h14" />),
  move: S(<path d="M5 12h14M13 6l6 6-6 6" />),
  price: S(<><path d="M3 12l9-9h8v8l-9 9z" /><circle cx="15.5" cy="8.5" r="1.5" /></>),
  undo: S(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>),
  inv: S(<><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></>),
  stock: S(<><path d="M12 16V4M6 10l6 6 6-6M4 20h16" /></>),
  sync: S(<><path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2" /><path d="M20 4v5h-5M4 20v-5h5" /></>),
  warn: S(<><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>),
  check: S(<path d="M5 12l5 5 9-10" />, 20),
  right: S(<path d="M9 6l6 6-6 6" />),
  left: S(<path d="M15 6l-6 6 6 6" />),
  down: S(<path d="M6 9l6 6 6-6" />),
  x: S(<path d="M6 6l12 12M18 6L6 18" />, 16),
  cal: S(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>, 15),
  dl: S(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />, 15),
  search: S(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>, 16),
  file: S(<><path d="M6 3h9l5 5v13H6z" /><path d="M14 3v6h6M9 14h8M9 18h8" /></>, 18),
  grid: S(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 4v16" /></>, 18),
  doc: S(<><path d="M6 3h9l5 5v13H6z" /><path d="M14 3v6h6" /></>, 18),
};

export const fmtKc = (n: number) => `${Math.round(n).toLocaleString('cs-CZ')} Kč`;
const kc = (n: number | null) => (n == null ? 'dohodou' : fmtKc(n));
export const impactCls = (e: Pick<HEntry, 'impact' | 'arrow'>) => (e.impact == null || !e.arrow ? '' : e.impact < 0 ? 'dn' : 'up');
export const impactTxt = (e: Pick<HEntry, 'impact' | 'arrow'>) => (e.impact == null ? '' : e.arrow ? `${e.impact < 0 ? '▼' : '▲'} ${fmtKc(Math.abs(e.impact))}` : fmtKc(e.impact));
const arrow = (n: number) => (n === 0 ? '0 Kč' : `${n < 0 ? '▼' : '▲'} ${fmtKc(Math.abs(n))}`);
const TZ = 'Europe/Prague';
const longWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('cs-CZ', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric' })} ${d.toLocaleTimeString('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}`;
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric' });
const pl = (n: number, f: [string, string, string]) => `${n.toLocaleString('cs-CZ')} ${n === 1 ? f[0] : n >= 2 && n <= 4 ? f[1] : f[2]}`;

/** Stránkování ‹ 1 2 3 … 38 › jako ve Všech kartách. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return <nav className="pager" aria-label="Stránky" />;
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  if (page <= 3) [2, 3].forEach((p) => p <= pages && set.add(p));
  const nums = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) out.push('…'); out.push(n); });
  return (
    <nav className="pager" aria-label="Stránky">
      <button type="button" aria-label="Předchozí stránka" disabled={page <= 1} onClick={() => onPage(page - 1)}>{HI.left}</button>
      {out.map((n, i) => n === '…' ? <button key={`e${i}`} type="button" disabled>…</button>
        : <button key={n} type="button" className={n === page ? 'on' : ''} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>)}
      <button type="button" aria-label="Další stránka" disabled={page >= pages} onClick={() => onPage(page + 1)}>{HI.right}</button>
    </nav>
  );
}

function HModal({ title, sub, cls = '', onClose, children, foot }: {
  title: React.ReactNode; sub?: React.ReactNode; cls?: string; onClose: () => void; children: React.ReactNode; foot: React.ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="dim" onClick={onClose} />
      <div className={`modal hmod ${cls}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="mh"><div style={{ flex: 1, minWidth: 0 }}><h3>{title}</h3>{sub ? <small>{sub}</small> : null}</div>
          <button type="button" className="x" onClick={onClose} aria-label="Zavřít">{HI.x}</button></div>
        <div className="mb">{children}</div>
        <div className="mf">{foot}</div>
      </div>
    </>
  );
}

// ---------- Historie jedné karty ----------

function Chart({ h }: { h: CardHistory }) {
  const t1 = Date.now(), t0 = t1 - 90 * 864e5;
  const steps = h.priceSteps.filter((s) => s.p != null) as { at: string; p: number }[];
  const vals = [...steps.map((s) => s.p), ...h.market.map((m) => m.p), ...h.sales.map((s) => s.p)];
  if (!vals.length) return <div className="hnote" style={{ padding: '20px 0' }}>Za posledních 90 dní tu není cena ani tržní data.</div>;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { lo = Math.max(0, lo - Math.max(5, lo * 0.1)); hi = hi + Math.max(5, hi * 0.1); }
  const pad = (hi - lo) * 0.08; lo = Math.max(0, lo - pad); hi += pad;
  const X = (t: number) => 36 + ((Math.min(t1, Math.max(t0, t)) - t0) / (t1 - t0)) * 340;
  const Y = (v: number) => 110 - ((v - lo) / (hi - lo)) * 90;
  let mine = '';
  steps.forEach((s, i) => {
    const x = X(new Date(s.at).getTime()), y = Y(s.p);
    mine += i === 0 ? `M${X(t0).toFixed(1)} ${y.toFixed(1)}` : ` H${x.toFixed(1)} V${y.toFixed(1)}`;
  });
  if (steps.length) mine += ` H${X(t1).toFixed(1)}`;
  const market = h.market.map((m, i) => `${i ? 'L' : 'M'}${X(new Date(`${m.day}T12:00:00Z`).getTime()).toFixed(1)} ${Y(m.p).toFixed(1)}`).join(' ');
  const lab = (v: number) => Math.round(v).toLocaleString('cs-CZ');
  const ticks = [0, 1, 2, 3].map((i) => t0 + ((t1 - t0) * i) / 3);
  return (
    <svg viewBox="0 0 380 150" width="100%" role="img" aria-label={`Graf ceny za 90 dní: vaše cena ${kc(h.price)}, ${pl(h.sales.length, ['prodej', 'prodeje', 'prodejů'])}`}>
      <g stroke="var(--line)" strokeWidth="1"><path d="M36 20H376M36 65H376M36 110H376" /></g>
      <g fontFamily="var(--fm)" fontSize="11" fill="var(--ink-muted)">
        <text x="0" y="24">{lab(hi)}</text><text x="0" y="69">{lab((hi + lo) / 2)}</text><text x="0" y="114">{lab(lo)}</text>
        {ticks.map((t, i) => <text key={i} x={i === 3 ? 340 : 36 + i * 105} y="140">{shortDate(new Date(t).toISOString())}</text>)}
      </g>
      {market ? <path d={market} fill="none" stroke="var(--ink-muted)" strokeWidth="2" strokeDasharray="5 4" /> : null}
      {mine ? <><path d={`${mine} V110 H${X(t0)} Z`} fill="var(--accent)" fillOpacity=".08" /><path d={mine} fill="none" stroke="var(--accent)" strokeWidth="2.5" /></> : null}
      <g fill="var(--accent)" stroke="var(--surface)" strokeWidth="2">
        {h.sales.map((s, i) => <circle key={i} cx={X(new Date(s.at).getTime())} cy={Y(s.p)} r="5"><title>{`Prodej ${s.q} ks za ${kc(s.p)}, ${shortDate(s.at)}`}</title></circle>)}
      </g>
    </svg>
  );
}

export function CardPanel({ listing, shop, onClose, stockHref }: { listing: string; shop: boolean; onClose: () => void; stockHref: (name: string) => string }) {
  const [h, setH] = useState<CardHistory | null>(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState<'all' | 'sale' | 'price'>('all');
  const [n, setN] = useState(5);
  useEffect(() => {
    let live = true;
    historyCard(listing).then((r) => { if (!live) return; if ('error' in r) setErr(r.error); else setH(r); });
    return () => { live = false; };
  }, [listing]);
  if (err || !h) {
    return <aside className="pan" aria-label="Historie karty"><div className="hrw"><span className="hsp hnote">{err || 'Načítám historii karty…'}</span><button type="button" className="x" onClick={onClose} aria-label="Zavřít">{HI.x}</button></div></aside>;
  }
  const tl = h.timeline.filter((t) => f === 'all' || t.kind === f);
  const first = h.priceSteps.find((s) => s.p != null)?.p ?? null;
  const ch = first && h.price ? Math.round(((h.price - first) / first) * 100) : null;
  function dl() {
    const rows = [['Kdy', 'Co se stalo', 'Podrobnosti', 'Dopad (Kč)'], ...h!.timeline.map((t) => [new Date(t.at).toLocaleString('cs-CZ', { timeZone: TZ }), t.title, t.detail, t.impact ?? ''])];
    const text = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = `v4cards-historie-${h!.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.csv`;
    a.click();
  }
  return (
    <aside className="pan" aria-label="Historie karty">
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {h.image ? <img className="pimg" src={h.image} alt={h.name} /> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <h3>{h.name}</h3>
          <small style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{[h.set, h.cond, h.lang].filter(Boolean).map((x, i) => <span key={i}>{i ? ' · ' : ''}{i === 1 ? <span className="mono">{x}</span> : x}</span>)}</small>
          {h.loc ? <small style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{h.loc}</small> : null}
        </div>
        <button type="button" className="x" onClick={onClose} aria-label="Zavřít">{HI.x}</button>
      </div>
      <div className="kv">
        <div><small>{shop ? 'Skladem' : 'Ve sbírce'}</small><b>{h.total} ks</b></div>
        <div><small>Na prodej</small><b>{h.forSale} ks</b></div>
        <div><small>Prodáno celkem</small><b>{h.sold} ks</b></div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="lbl">Vaše cena a trh · 90 dní</span>
        <span className="mono" style={{ fontSize: 13 }}>{kc(h.price)}{ch ? <> <span className={ch < 0 ? 'dn' : 'up'}>{ch < 0 ? '▼' : '▲'} {Math.abs(ch)} %</span></> : null}</span>
      </div>
      <Chart h={h} />
      <div className="leg"><span><i style={{ '--c': 'var(--accent)' } as React.CSSProperties} />Vaše cena</span><span><i className="d" style={{ '--c': 'var(--ink-muted)' } as React.CSSProperties} />Trh</span><span><i className="p" />Prodej</span></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="lbl">Co se s kartou dělo</span>
        <div className="hchips">{([['all', 'Vše'], ['sale', 'Prodeje'], ['price', 'Ceny']] as const).map(([k, t]) => (
          <button key={k} type="button" className={`chip xs${f === k ? ' on' : ''}`} onClick={() => { setF(k); setN(5); }}>{t}</button>))}</div>
      </div>
      <div>
        {tl.length ? tl.slice(0, n).map((t, i) => (
          <div key={i} className="tl">
            <span className="ic" style={{ '--c': `var(--c-${t.kind})` } as React.CSSProperties}>{HI[t.kind === 'stock' ? 'stock' : t.kind]}</span>
            <span><b>{t.title}</b><small>{shortDate(t.at)}{t.detail ? ` · ${t.detail}` : ''}</small></span>
            <span className={`imp r ${t.impact == null || !t.arrow ? '' : t.impact < 0 ? 'dn' : 'up'}`}>{t.impact == null ? '' : t.arrow ? arrow(t.impact) : fmtKc(t.impact)}</span>
          </div>
        )) : <div className="hnote" style={{ padding: '10px 0' }}>Zatím tu nic není.</div>}
        {tl.length > n ? <button type="button" className="btn sm g" style={{ marginTop: 4 }} onClick={() => setN(n + 10)}>Zobrazit dalších {Math.min(10, tl.length - n)} {tl.length - n === 1 ? 'událost' : tl.length - n < 5 ? 'události' : 'událostí'}</button> : null}
      </div>
      <div className="hrw" style={{ borderTop: '1px solid var(--line)', paddingTop: 20, marginTop: 6, flexWrap: 'nowrap' }}>
        <button type="button" className="btn g" style={{ padding: '0 4px' }} onClick={dl}>{HI.dl}Stáhnout historii</button>
        <span className="hsp" />
        <Link className="btn" href={stockHref(h.name)}>Otevřít kartu {shop ? 've skladu' : 've sbírce'}</Link>
      </div>
    </aside>
  );
}

// ---------- Detail hromadné změny ----------

export function EventModal({ id, canUndo, onClose, onUndo }: { id: number; canUndo: boolean; onClose: () => void; onUndo: () => void }) {
  const [d, setD] = useState<EventDetail | null>(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState<'all' | 'up' | 'dn'>('all');
  const [q, setQ] = useState('');
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [extra, setExtra] = useState(0);
  useEffect(() => { historyEvent(id).then((r) => ('error' in r ? setErr(r.error) : setD(r))); }, [id]);
  useEffect(() => { setPage(1); setExtra(0); }, [f, q, asc]);
  const price = d?.kind === 'price';
  const diff = (r: EventDetail['rows'][number]) => (price ? (r.p0 != null && r.p1 != null ? r.p1 - r.p0 : 0) : r.q1 - r.q0);
  const rows = useMemo(() => {
    if (!d) return [];
    const t = fold(q);
    return d.rows.filter((r) => (f === 'all' || (f === 'up' ? diff(r) > 0 : diff(r) < 0)) && (!t || fold(r.name).includes(t)))
      .sort((a, b) => (asc ? 1 : -1) * (Math.abs(diff(a)) - Math.abs(diff(b))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, f, q, asc]);
  if (!d) return <HModal title={err || 'Načítám…'} cls="w820" onClose={onClose} foot={<button type="button" className="btn" onClick={onClose}>Zavřít</button>}><div /></HModal>;
  const up = d.rows.filter((r) => diff(r) > 0), dn = d.rows.filter((r) => diff(r) < 0);
  const val = (r: EventDetail['rows'][number]) => (price ? diff(r) : diff(r) * (r.p1 ?? r.p0 ?? 0));
  const sUp = up.reduce((s, r) => s + val(r), 0), sDn = dn.reduce((s, r) => s + val(r), 0);
  const P = 8, pages = Math.max(1, Math.ceil(rows.length / P)), shown = rows.slice((page - 1) * P, (page + extra) * P), to = Math.min(rows.length, (page + extra) * P);
  const lab = price ? ['Zdraženo', 'Zlevněno'] : ['Přibylo', 'Ubylo'];
  return (
    <HModal title={d.title} sub={[longWhen(d.at), d.detail].filter(Boolean).join(' · ')} cls="w820" onClose={onClose}
      foot={<><span className="note">{d.auto && price ? 'Automatické ceny běží každou noc ve 2:00' : 'Změna je zapsaná v Historii'}</span>
        <button type="button" className="btn" onClick={onClose}>Zavřít</button>
        {canUndo && d.canUndo ? <button type="button" className="btn" onClick={onUndo}>Vrátit změnu</button> : null}</>}>
      <div className="kv">
        <div><small>{lab[0]}</small><b>{up.length} <span className="up" style={{ fontSize: 13 }}>{arrow(sUp)}</span></b></div>
        <div><small>{lab[1]}</small><b>{dn.length} <span className="dn" style={{ fontSize: 13 }}>{arrow(sDn)}</span></b></div>
        <div><small>Celkem v nabídce</small><b className={sUp + sDn < 0 ? 'dn' : 'up'}>{arrow(sUp + sDn)}</b></div>
      </div>
      <div className="hrw">
        <div className="hchips">{([['all', 'Vše', d.rows.length], ['up', lab[0], up.length], ['dn', lab[1], dn.length]] as const).map(([k, t, n]) => (
          <button key={k} type="button" className={`chip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{t} <em>{n}</em></button>))}</div>
        <span className="hsp" />
        <label className="inp hinp">{HI.search}<input placeholder="Hledat kartu" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="htbl" style={{ '--cols': 'minmax(0,1fr) 90px 90px 100px 90px' } as React.CSSProperties}>
        <div className="th"><span>Karta</span><span className="c">Před</span><span className="c">Po</span>
          <span className="c"><button type="button" onClick={() => setAsc(!asc)}>Změna {asc ? '▴' : '▾'}</button></span><span className="c">Trh</span></div>
        {shown.map((r) => {
          const x = diff(r);
          return (
            <div key={r.l} className="tr">
              <span className="crd">{r.image ? <img src={r.image} alt="" loading="lazy" /> : null}<span className="tx"><span className="ttl">{r.name}</span><small>{[r.cond, r.loc].filter(Boolean).join(' · ')}</small></span></span>
              <span className="imp">{price ? kc(r.p0) : `${r.q0} ks`}</span>
              <span className="imp ink">{price ? kc(r.p1) : `${r.q1} ks`}</span>
              <span className={`imp ${x < 0 ? 'dn' : x > 0 ? 'up' : ''}`}>{x === 0 ? '–' : price ? arrow(x) : `${x > 0 ? '▲' : '▼'} ${Math.abs(x)} ks`}</span>
              <span className="imp">{r.market ? fmtKc(r.market) : '–'}</span>
            </div>
          );
        })}
        {!shown.length ? <div className="tr"><span className="hnote">Nic neodpovídá filtru.</span></div> : null}
        <div className="hfoot">
          <span className="fl mono">{rows.length ? `${(page - 1) * P + 1}–${to} z ${rows.length}` : '0'}</span>
          <Pager page={page + extra} pages={pages} onPage={(p) => { setPage(p); setExtra(0); }} />
          <span className="fr">{to < rows.length ? <button type="button" className="more" onClick={() => setExtra(extra + 1)}>Zobrazit dalších {Math.min(P, rows.length - to)}{HI.down}</button> : null}</span>
        </div>
      </div>
    </HModal>
  );
}

// ---------- Vrátit hromadnou změnu ----------

export function UndoModal({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: (t: string, ok: boolean) => void }) {
  const [p, setP] = useState<UndoPreview | null>(null);
  const [err, setErr] = useState('');
  const [all, setAll] = useState(false);
  const [sf, setSf] = useState<'all' | 'sold' | 'manual'>('all');
  const [pending, start] = useTransition();
  useEffect(() => { historyUndoPreview(id).then((r) => ('error' in r ? setErr(r.error) : setP(r))); }, [id]);
  if (!p) return <HModal title={err || 'Načítám…'} onClose={onClose} foot={<button type="button" className="btn" onClick={onClose}>Zavřít</button>}><div /></HModal>;
  const price = p.kind === 'price';
  const back = p.rows.filter((r) => !r.stays), stay = p.rows.filter((r) => r.stays);
  const name = p.title.replace(/^Vráceno: /, '').split(' · ')[0].replace(/:\s*\d.*$/, '');
  const staysF = stay.filter((r) => sf === 'all' || r.stays === sf);
  const staysShown = all ? staysF : staysF.slice(0, 3);
  const btn = price ? `Vrátit ${back.length} ${back.length === 1 ? 'cenu' : back.length >= 2 && back.length <= 4 ? 'ceny' : 'cen'}` : `Vrátit ${pl(back.length, ['kartu', 'karty', 'karet'])}`;
  function go() {
    start(async () => {
      const r = await stockUndo(id);
      onDone(r.error ?? `Vráceno. ${back.length === 1 ? 'Změna se zapsala' : `${pl(r.count ?? back.length, ['karta', 'karty', 'karet'])} se vrátily`} do Historie a jde vrátit zpět.`, !r.error);
    });
  }
  return (
    <HModal title={`Vrátit hromadnou změnu: ${name}`} sub={`${longWhen(p.at)} · ${pl(p.count, ['karta', 'karty', 'karet'])}`} cls="w760" onClose={onClose}
      foot={<><span className="note">Vrácení se zapíše do Historie a jde vrátit zpět</span>
        <button type="button" className="btn" onClick={onClose}>Zrušit</button>
        <button type="button" className="btn p" disabled={pending || !back.length} onClick={go}>{btn}</button></>}>
      <div className="info">
        {back.length ? <>Vrátíme {price ? 'ceny' : 'kusy'} <b>{pl(back.length, ['karty', 'karet', 'karet'])}</b> na hodnoty před změnou.</> : <>Všechny karty se od změny prodaly nebo jste je změnili jinak, není co vracet.</>}
        {stay.length && back.length ? <> <b>{pl(stay.length, ['karta', 'karty', 'karet'])}</b> se mezitím {stay.length === 1 ? 'prodala nebo jste jí' : 'prodaly nebo jste jim'} {price ? 'cenu' : 'kusy'} změnili ručně, ty necháme být.</> : null}
      </div>
      {back.length ? (
        <>
          <div className="lbl">Vrátí se · {back.length}</div>
          <div className="htbl" style={{ '--cols': 'minmax(0,1fr) 100px 24px 110px' } as React.CSSProperties}>
            <div className="th"><span>Karta</span><span className="c">Teď</span><span /><span className="c">Po vrácení</span></div>
            {back.slice(0, 5).map((r) => (
              <div key={r.l} className="tr" style={{ minHeight: 50 }}>
                <span className="crd">{r.image ? <img src={r.image} alt="" loading="lazy" /> : null}<span className="ttl">{r.name}</span></span>
                <span className="imp">{r.now}</span><span className="imp">→</span><span className="imp ink">{r.back}</span>
              </div>
            ))}
            <div className="hfoot"><span className="fl">{back.length > 5 ? `a ${pl(back.length - 5, ['další karta', 'další karty', 'dalších karet'])}` : ''}</span>
              <span className="mono">{price ? 'nabídka' : 'hodnota'} celkem <span className={p.total < 0 ? 'dn' : 'up'}>{arrow(p.total)}</span></span></div>
          </div>
        </>
      ) : null}
      {stay.length ? (
        <div className="frame">
          <div className="fh">Zůstane beze změny · {stay.length}
            {stay.length > 3 ? <><span className="hsp" /><span className="hchips">{([['all', 'Vše'], ['sold', 'Prodáno'], ['manual', 'Upraveno ručně']] as const).map(([k, t]) => (
              <button key={k} type="button" className={`chip xs${sf === k ? ' on' : ''}`} style={{ height: 26, fontSize: 12, padding: '0 10px', textTransform: 'none', letterSpacing: 0 }} onClick={() => setSf(k)}>{t}</button>))}</span></> : null}
          </div>
          {staysShown.map((r) => (
            <div key={r.l} className="set">
              <span className="crd">{r.image ? <img src={r.image} alt="" loading="lazy" /> : null}<span className="d"><b>{r.name}</b><small>{r.stays === 'sold' ? 'mezitím prodáno' : `teď ${r.now}, změněno později`}</small></span></span>
              <span className="tag n">{r.stays === 'sold' ? 'Prodáno' : 'Upraveno ručně'}</span>
            </div>
          ))}
          {!all && staysF.length > 3 ? <div className="set" style={{ justifyContent: 'center' }}><button type="button" className="more" onClick={() => setAll(true)}>Zobrazit všech {staysF.length}{HI.down}</button></div> : null}
        </div>
      ) : null}
    </HModal>
  );
}

// ---------- Co hlídat ----------

function Sw({ on, set, dis }: { on: boolean; set: (v: boolean) => void; dis?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} disabled={dis} className={`sw${on ? ' on' : ''}`} onClick={() => set(!on)} />;
}
function Num({ v, set, pre, suf, dis, w = 52 }: { v: number; set: (n: number) => void; pre?: string; suf?: string; dis?: boolean; w?: number }) {
  return (
    <label className="dd">{pre}<input inputMode="numeric" disabled={dis} style={{ width: w }} value={String(v)} onChange={(e) => set(Number(e.target.value.replace(/\D/g, '')) || 0)} />{suf}</label>
  );
}

export function WatchModal({ rules, lead, owner, hoursText, onClose, onSaved }: {
  rules: WatchRules; lead: boolean; owner: string; hoursText: string; onClose: () => void; onSaved: () => void;
}) {
  const [r, setR] = useState<WatchRules>(rules);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const up = <K extends keyof WatchRules>(k: K, v: Partial<WatchRules[K]> | WatchRules[K]) =>
    setR((x) => ({ ...x, [k]: typeof v === 'object' && v ? { ...(x[k] as object), ...v } : v }));
  const dis = !lead;
  function save() {
    start(async () => { const res = await watchSave(owner, r); if (res.error) setErr(res.error); else onSaved(); });
  }
  return (
    <HModal title="Co hlídat" sub="Neobvyklé změny se objeví v Historii pod K prověření" cls="w720" onClose={onClose}
      foot={<><span className="note">{err || (lead ? 'Platí pro všechny zaměstnance' : 'Pravidla mění vedoucí')}</span>
        <button type="button" className="btn" onClick={onClose}>Zrušit</button>
        {lead ? <button type="button" className="btn p" disabled={pending} onClick={save}>Uložit</button> : null}</>}>
      <div style={{ height: 4 }} />
      <div className="frame">
        <div className="fh">Ceny</div>
        <div className="set"><span className="d"><b>Cena pod trhem</b><small>Ruční změna, která dá kartu hluboko pod trh</small></span>
          <span className="c"><Num v={r.below_market.pct} set={(n) => up('below_market', { pct: n })} pre="víc než" suf="%" dis={dis} w={32} /><Sw on={r.below_market.on} set={(v) => up('below_market', { on: v })} dis={dis} /></span></div>
        <div className="set"><span className="d"><b>Velké zlevnění naráz</b><small>Import nebo hromadná změna zlevní mnoho karet</small></span>
          <span className="c"><Num v={r.big_drop.pct} set={(n) => up('big_drop', { pct: n })} pre="o víc než" suf="%" dis={dis} w={32} /><Sw on={r.big_drop.on} set={(v) => up('big_drop', { on: v })} dis={dis} /></span></div>
      </div>
      <div className="frame">
        <div className="fh">Kusy</div>
        <div className="set"><span className="d"><b>Ubylo bez prodeje</b><small>Kusy odebrané ručně, ne objednávkou ani prodejem na prodejně</small></span>
          <span className="c"><Num v={r.loss.qty} set={(n) => up('loss', { qty: n })} pre="víc než" suf="ks" dis={dis} w={32} /><Num v={r.loss.czk} set={(n) => up('loss', { czk: n })} pre="nebo" suf="Kč" dis={dis} /><Sw on={r.loss.on} set={(v) => up('loss', { on: v })} dis={dis} /></span></div>
        <div className="set"><span className="d"><b>Velký rozdíl v inventuře</b><small>Chybějící kusy při počítání</small></span>
          <span className="c"><Num v={r.inv_diff.czk} set={(n) => up('inv_diff', { czk: n })} pre="nad" suf="Kč" dis={dis} /><Sw on={r.inv_diff.on} set={(v) => up('inv_diff', { on: v })} dis={dis} /></span></div>
      </div>
      <div className="frame">
        <div className="fh">Čas</div>
        <div className="set"><span className="d"><b>Změny mimo otevírací dobu</b><small>{hoursText ? `Podle otevírací doby obchodu ${hoursText}` : 'Otevírací dobu vyplňte na stránce obchodu, do té doby se nehlídá'}</small></span>
          <span className="c"><Sw on={r.off_hours.on} set={(v) => up('off_hours', { on: v })} dis={dis} /></span></div>
      </div>
      <div className="frame">
        <div className="fh">Synchronizace</div>
        <div className="set"><span className="d"><b>Opakovaná chyba synchronizace</b><small>E-shop nebo napojení neodpovídá · začne platit s napojením e-shopu</small></span>
          <span className="c"><Num v={r.sync_fail.n} set={(n) => up('sync_fail', { n })} suf="× za sebou" dis={dis} w={24} /><Sw on={r.sync_fail.on} set={(v) => up('sync_fail', { on: v })} dis={dis} /></span></div>
      </div>
      <div className="frame">
        <div className="fh">Komu dát vědět</div>
        <div className="set"><span className="d"><b>Vedoucí</b><small>E-mail jednou denně s novými změnami k prověření</small></span>
          <span className="c"><Sw on={r.notify_lead} set={(v) => up('notify_lead', v)} dis={dis} /></span></div>
        <div className="set"><span className="d"><b>Ten, kdo změnu udělal</b><small>E-mail jednou denně o jeho změnách k prověření</small></span>
          <span className="c"><Sw on={r.notify_actor} set={(v) => up('notify_actor', v)} dis={dis} /></span></div>
      </div>
    </HModal>
  );
}

// ---------- Vlastní období ----------

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MONTHS = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];
const dmy = (s: string) => { const [y, m, d] = s.split('-').map(Number); return `${d}. ${m}. ${y}`; };

export function PeriodPop({ period, onCancel, onApply }: { period: Period; onCancel: () => void; onApply: (od: string, doo: string) => void }) {
  const today = ymd(new Date());
  const min = ymd(new Date(Date.now() - 365 * 864e5));
  const [mode, setMode] = useState<'one' | 'range'>(period.key === 'vlastni' && period.od === period.do ? 'one' : 'range');
  const [a, setA] = useState(period.od);
  const [b, setB] = useState<string | null>(period.do);
  const [m, setM] = useState(() => { const [y, mo] = period.do.split('-').map(Number); return new Date(y, mo - 1, 1); });
  const days: { d: string; out: boolean }[] = [];
  const startDow = (m.getDay() + 6) % 7;
  const first = new Date(m.getFullYear(), m.getMonth(), 1 - startDow);
  for (let i = 0; i < 42; i++) { const d = new Date(first); d.setDate(first.getDate() + i); days.push({ d: ymd(d), out: d.getMonth() !== m.getMonth() }); }
  const weeks = days.slice(35).every((x) => x.out) ? days.slice(0, 35) : days;
  function pick(d: string) {
    if (mode === 'one') { setA(d); setB(d); return; }
    if (!a || b) { setA(d); setB(null); return; }
    if (d < a) { setB(a); setA(d); } else setB(d);
  }
  const end = mode === 'one' ? a : b;
  return (
    <div className="pop" style={{ left: 0, top: 44, padding: 16, width: 334 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="seg" role="group" aria-label="Výběr" style={{ alignSelf: 'flex-start', height: 30 }}>
          <button type="button" className={mode === 'one' ? 'on' : ''} onClick={() => { setMode('one'); setB(a); }}>Jeden den</button>
          <button type="button" className={mode === 'range' ? 'on' : ''} onClick={() => setMode('range')}>Od – do</button>
        </div>
        {mode === 'one' ? <div className="din on">{dmy(a)}</div> : (
          <div className="hrw" style={{ flexWrap: 'nowrap' }}>
            <span className={`din${b ? '' : ' on'}`}>{dmy(a)}</span><span style={{ color: 'var(--ink-muted)' }}>–</span>
            <span className={`din${b ? ' on' : ''}`}>{b ? dmy(b) : 'vyberte konec'}</span>
          </div>
        )}
        <div className="hrw" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="x" aria-label="Předchozí měsíc" disabled={ymd(m) <= min} onClick={() => setM(new Date(m.getFullYear(), m.getMonth() - 1, 1))}>{HI.left}</button>
          <b style={{ font: '600 14px var(--fd)' }}>{MONTHS[m.getMonth()]} {m.getFullYear()}</b>
          <button type="button" className="x" aria-label="Další měsíc" disabled={ymd(new Date(m.getFullYear(), m.getMonth() + 1, 1)) > today} onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + 1, 1))}>{HI.right}</button>
        </div>
        <div className="cal">
          {['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map((h) => <span key={h} className="h">{h}</span>)}
          {weeks.map(({ d, out }) => {
            const isEnd = d === a || d === end;
            const inR = end && d > a && d < end;
            return (
              <button key={d} type="button" disabled={d > today || d < min} onClick={() => pick(d)}
                className={[out ? 'o' : '', inR ? 'in' : '', isEnd ? 'e' : ''].filter(Boolean).join(' ')}>{Number(d.slice(8))}</button>
            );
          })}
        </div>
        <div className="hrw" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn sm g" onClick={onCancel}>Zrušit</button>
          <button type="button" className="btn sm p" disabled={!a || !end} onClick={() => onApply(a, end ?? a)}>Použít</button>
        </div>
      </div>
    </div>
  );
}
