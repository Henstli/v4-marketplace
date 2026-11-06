'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { fold } from '@/lib/import/columns';
import { xlsx } from '@/lib/xlsx';
import { stockUndo } from './actions';
import { flagResolve } from './history-actions';
import type { HData, HEntry, HFlag, HIcon, HKind, PeriodKey } from './history';
import { CardPanel, EventModal, HI, PeriodPop, UndoModal, WatchModal, Pager, fmtKc, impactCls, impactTxt } from './HistoryParts';

type Filter = 'all' | HKind | 'flag';
const PAGE = 10;
const COLOR: Record<HKind, string> = { sale: 'var(--c-sale)', stock: 'var(--c-stock)', price: 'var(--c-price)', sync: 'var(--c-sync)', inv: 'var(--c-inv)' };
const ICON_COLOR = (e: HEntry) => (e.icon === 'undo' ? 'var(--c-stock)' : COLOR[e.kind]);
const TZ = 'Europe/Prague';
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
function dayLabel(iso: string) {
  const k = dayKey(iso), t = dayKey(new Date().toISOString()), y = dayKey(new Date(Date.now() - 864e5).toISOString());
  const d = new Date(iso);
  const wd = d.toLocaleDateString('cs-CZ', { timeZone: TZ, weekday: 'long' });
  const dm = d.toLocaleDateString('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric', ...(k.slice(0, 4) !== t.slice(0, 4) ? { year: 'numeric' } : {}) });
  return k === t ? `Dnes · ${wd} ${dm}` : k === y ? `Včera · ${wd} ${dm}` : `${wd} ${dm}`;
}
const plural = (n: number, f: [string, string, string]) => `${n.toLocaleString('cs-CZ')} ${n === 1 ? f[0] : n >= 2 && n <= 4 ? f[1] : f[2]}`;
const whenShort = (iso: string) => {
  const today = dayKey(new Date().toISOString()) === dayKey(iso);
  return today ? hhmm(iso) : `${new Date(iso).toLocaleDateString('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric' })} ${hhmm(iso)}`;
};

/** Historie skladu a sbírky podle plátna: období, typy změn, K prověření, stránkování, detail karty a hromadné změny. */
export function StockHistory({ data, shop, canUndo, owner, obchod, initialKind = 'all' }: {
  data: HData; shop: boolean; canUndo: boolean; owner: string; obchod: string | null; initialKind?: Filter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { entries, flags, period } = data;
  const [kind, setKind] = useState<Filter>(initialKind);
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [place, setPlace] = useState('');
  const [page, setPage] = useState(1);
  const [extra, setExtra] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [modal, setModal] = useState<{ t: 'event' | 'undo'; id: number } | null>(null);
  const [flagView, setFlagView] = useState<'wait' | 'done'>('wait');
  const [watch, setWatch] = useState(false);
  const [pop, setPop] = useState<'dl' | 'period' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setPage(1); setExtra(0); }, [kind, q, who, place, period.from]);
  useEffect(() => {
    if (!pop) return;
    const h = (e: MouseEvent) => { if (barRef.current && !barRef.current.contains(e.target as Node)) setPop(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [pop]);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); } }, [msg]);

  const people = useMemo(() => [...new Set(entries.map((e) => e.who).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'cs')), [entries]);
  const places = useMemo(() => [...new Set(entries.flatMap((e) => e.places))].sort((a, b) => a.localeCompare(b, 'cs', { numeric: true })), [entries]);
  const waiting = flags.filter((f) => !f.resolvedAt);
  const resolved = flags.filter((f) => f.resolvedAt);
  const cats: [Filter, string][] = shop
    ? [['all', 'Vše'], ['sale', 'Prodeje'], ['stock', 'Sklad'], ['price', 'Ceny'], ['sync', 'Synchronizace'], ['inv', 'Inventura']]
    : [['all', 'Vše'], ['sale', 'Prodeje'], ['stock', 'Sbírka'], ['price', 'Ceny']];
  const base = useMemo(() => {
    const t = fold(q);
    return entries.filter((e) => (!who || e.who === who) && (!place || e.places.includes(place)) && (!t || e.search.includes(t)));
  }, [entries, q, who, place]);
  const list = useMemo(() => (kind === 'all' || kind === 'flag' ? base : base.filter((e) => e.kind === kind)), [base, kind]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const shown = list.slice((page - 1) * PAGE, (page + extra) * PAGE);
  const dayCount = useMemo(() => { const m = new Map<string, number>(); for (const e of list) m.set(dayKey(e.at), (m.get(dayKey(e.at)) ?? 0) + 1); return m; }, [list]);

  function go(params: Record<string, string | null>) {
    const n = new URLSearchParams(sp.toString());
    n.set('zalozka', 'historie');
    for (const [k, v] of Object.entries(params)) if (v == null) n.delete(k); else n.set(k, v);
    router.push(`${pathname}?${n.toString()}`, { scroll: false });
  }
  const setPeriod = (k: PeriodKey, od?: string, doo?: string) => {
    setPop(null);
    go({ obdobi: k === '7' ? null : k, od: od ?? null, do: doo ?? null });
  };

  function undo(id: number) {
    start(async () => {
      const r = await stockUndo(id);
      setMsg(r.error ? { ok: false, t: r.error } : { ok: true, t: 'Změna je vrácená. Nahoře je nový řádek, který jde vrátit zpět.' });
      router.refresh();
    });
  }
  function open(e: HEntry) {
    if (e.multi > 1 && e.eventId) setModal({ t: 'event', id: e.eventId });
    else if (e.listing) setSel(e.listing === sel ? null : e.listing);
    else if (e.href) router.push(e.href);
  }
  function onUndo(e: HEntry) {
    if (!e.eventId) return;
    if (e.multi > 1) setModal({ t: 'undo', id: e.eventId }); else undo(e.eventId);
  }

  function rowsFor(all: boolean) {
    const L = all ? list : shown;
    return L.map((e) => [new Date(e.at).toLocaleString('cs-CZ', { timeZone: TZ }), cats.find((c) => c[0] === e.kind)?.[1] ?? e.kind, e.title, e.detail ?? '',
      e.impact ?? '', shop ? e.who ?? e.auto ?? '' : '', e.places.join(', '), e.undoneAt ? 'ano' : ''] as (string | number)[]);
  }
  const head = ['Kdy', 'Typ', 'Změna', 'Podrobnosti', 'Dopad (Kč)', ...(shop ? ['Kdo'] : []), 'Místo', 'Vráceno'];
  const fix = (r: (string | number)[]) => (shop ? r : r.filter((_, i) => i !== 5));
  const fname = `v4cards-historie-${period.od}${period.do !== period.od ? `-${period.do}` : ''}`;
  function save(blob: Blob, name: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function csv() {
    const text = [head, ...rowsFor(true).map(fix)].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    save(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), `${fname}.csv`);
    setPop(null);
  }
  function excel() {
    const bytes = xlsx([head, ...rowsFor(true).map(fix)], 'Historie', shop ? [18, 14, 48, 40, 12, 16, 16, 10] : [18, 14, 48, 40, 12, 16, 10]);
    save(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fname}.xlsx`);
    setPop(null);
  }
  function pdf() {
    const p = new URLSearchParams({ druh: 'historie', od: period.od, do: period.do });
    if (obchod) p.set('obchod', obchod);
    window.open(`/prodat/export?${p.toString()}`, '_blank');
    setPop(null);
  }

  const split = !!sel;
  const cols = split ? '52px 28px 32px minmax(0,1fr) 110px' : shop ? '56px 28px 32px minmax(0,1fr) 130px 150px 124px' : '64px 28px 32px minmax(0,1fr) 140px 124px';
  const filterNote = [period.label, cats.find((c) => c[0] === kind)?.[1] ?? 'K prověření', who, place, q ? `„${q}“` : ''].filter(Boolean).join(' · ');

  // Řádky tabulky s dny a propojením vrácení.
  const body: React.ReactNode[] = [];
  let lastDay = '';
  shown.forEach((e, i) => {
    const d = dayKey(e.at);
    if (d !== lastDay) {
      lastDay = d;
      const n = dayCount.get(d) ?? 0;
      body.push(<div key={`d${d}`} className="hday">{dayLabel(e.at)}<span className="dayc">{plural(n, ['změna', 'změny', 'změn'])}</span></div>);
    }
    const next = shown[i + 1], prev = shown[i - 1];
    const lkA = !!e.revertsId && next?.eventId === e.revertsId && dayKey(next.at) === d;
    const lkB = !!e.eventId && prev?.revertsId === e.eventId && dayKey(prev.at) === d;
    const undoable = canUndo && e.canUndo && e.eventId;
    body.push(
      <div key={e.key} className={`tr click${e.undoneAt ? ' undone' : ''}${e.flagged && !split ? ' flag' : ''}${lkA ? ' lk-a' : ''}${lkB ? ' lk-b' : ''}${sel && e.listing === sel ? ' sel' : ''}`}
        role="button" tabIndex={0} onClick={() => open(e)} onKeyDown={(k) => { if (k.key === 'Enter') open(e); }}>
        <span className="tm">{hhmm(e.at)}</span>
        <span className="ic" style={{ '--c': ICON_COLOR(e) } as React.CSSProperties}>{HI[e.icon as HIcon]}</span>
        <Thumbs e={e} />
        <span className="tx">
          <span className="ttl">
            {e.undoneAt ? <s>{e.title}</s> : e.title}
            {e.undoneAt ? <span className="tag n">Vráceno</span> : null}
            {e.hromadne && !e.undoneAt ? <span className="tag n">Hromadně</span> : null}
            {e.flagged && !e.undoneAt ? <span className="tag w">K prověření</span> : null}
          </span>
          {e.undoneAt ? <small><span className="rel">vráceno v {whenShort(e.undoneAt)}{shop && e.undoneBy ? ` · ${e.undoneBy}` : ''}</span></small>
            : e.revertsId ? <small><span className="rel">vrací změnu z {e.revertsAt ? whenShort(e.revertsAt) : 'dřívějška'}</span></small>
            : e.detail || (split && shop) ? <small>{[e.detail, split && shop ? e.who ?? e.auto : null].filter(Boolean).join(' · ')}</small> : null}
        </span>
        <span className={`imp ${impactCls(e)}`}>{impactTxt(e)}</span>
        {split ? null : shop ? <span className="who">{e.who ? <><span className="av">{e.who[0]?.toUpperCase()}</span>{e.who}</> : e.auto ? <span className="auto">{e.auto}</span> : null}</span> : null}
        {split ? null : (
          <span className="acts">
            {undoable ? <button type="button" className="btn sm ub" disabled={pending} onClick={(x) => { x.stopPropagation(); onUndo(e); }}>Vrátit</button> : null}
            <span className="chev" aria-hidden="true">{HI.right}</span>
          </span>
        )}
      </div>,
    );
  });

  const from = list.length ? (page - 1) * PAGE + 1 : 0, to = Math.min(list.length, (page + extra) * PAGE);
  const table = (
    <div className="htbl" style={{ '--cols': cols } as React.CSSProperties}>
      <div className="th"><span>Čas</span><span /><span /><span>Změna</span><span className="c">Dopad</span>{split ? null : shop ? <span className="c">Kdo</span> : null}{split ? null : <span />}</div>
      {body.length ? body : (
        <div className="hempty"><small>{entries.length ? 'Nic neodpovídá filtru.' : 'Za vybrané období tu nic není. Sem se zapíše každá změna cen a kusů i každý prodej.'}</small></div>
      )}
      {list.length ? (
        <div className="hfoot">
          <span className="fl mono">{from}–{to} z {list.length.toLocaleString('cs-CZ')} · od nejnovějších</span>
          <Pager page={page + extra} pages={pages} onPage={(p) => { setPage(p); setExtra(0); }} />
          <span className="fr">{to < list.length ? <button type="button" className="more" onClick={() => setExtra((x) => x + 1)}>Zobrazit dalších {Math.min(PAGE, list.length - to)}{HI.down}</button> : null}</span>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="hz">
      <div className="hrw" ref={barRef} style={{ position: 'relative' }}>
        <div className="seg" role="group" aria-label="Období">
          {([['dnes', 'Dnes'], ['7', '7 dní'], ['30', '30 dní'], ['rok', 'Rok']] as [PeriodKey, string][]).map(([k, t]) => (
            <button key={k} type="button" className={period.key === k ? 'on' : ''} onClick={() => setPeriod(k)}>{t}</button>
          ))}
          <button type="button" className={period.key === 'vlastni' ? 'on' : ''} onClick={() => setPop(pop === 'period' ? null : 'period')}>
            {HI.cal}{period.key === 'vlastni' ? period.label : 'Vlastní'}
          </button>
        </div>
        {period.key === 'vlastni' ? null : <span className="rng">{period.label}</span>}
        <span className="hsp" />
        <button type="button" className="btn" onClick={() => setPop(pop === 'dl' ? null : 'dl')} aria-expanded={pop === 'dl'}>{HI.dl}Stáhnout</button>
        {pop === 'period' ? <PeriodPop period={period} onCancel={() => setPop(null)} onApply={(a, b) => setPeriod('vlastni', a, b)} /> : null}
        {pop === 'dl' ? (
          <div className="pop" style={{ right: 0, top: 44, width: 340 }}>
            <button type="button" className="mi" onClick={csv}>{HI.file}<span><b>Tabulka CSV</b><small>Každá změna na jednom řádku</small></span></button>
            <button type="button" className="mi" onClick={excel}>{HI.grid}<span><b>Excel</b><small>Stejná data, sloupce připravené pro účetní</small></span></button>
            <button type="button" className="mi" onClick={pdf}>{HI.doc}<span><b>Přehled za období (PDF)</b><small>Souhrn, prodeje a největší změny, k tisku</small></span></button>
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 6, padding: '10px 12px 6px', fontSize: 12.5, color: 'var(--ink-muted)' }}>
              Stáhne se jen to, co je vyfiltrované: {filterNote} · {plural(list.length, ['řádek', 'řádky', 'řádků'])}
            </div>
          </div>
        ) : null}
      </div>

      <div className="hchips">
        {cats.map(([k, t]) => (
          <button key={k} type="button" className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)} aria-pressed={kind === k}>
            {k !== 'all' ? <span className="dot" style={{ '--c': COLOR[k as HKind] } as React.CSSProperties} /> : null}
            {t} <em>{(k === 'all' ? base.length : base.filter((e) => e.kind === k).length).toLocaleString('cs-CZ')}</em>
          </button>
        ))}
        {shop ? (
          <>
            <span className="hdiv" />
            <button type="button" className={`chip${waiting.length ? ' warn' : ''}${kind === 'flag' ? ' on' : ''}`} onClick={() => setKind(kind === 'flag' ? 'all' : 'flag')} aria-pressed={kind === 'flag'}>
              K prověření {waiting.length ? <b>{waiting.length}</b> : <em>0</em>}
            </button>
          </>
        ) : null}
      </div>

      {kind === 'flag' ? (
        <FlagsView flags={flagView === 'wait' ? waiting : resolved} view={flagView} setView={setFlagView} counts={[waiting.length, resolved.length]}
          lead={data.lead} canUndo={canUndo} pending={pending} onWatch={() => setWatch(true)}
          onOk={(f) => start(async () => { const r = await flagResolve(f.id); setMsg(r.error ? { ok: false, t: r.error } : { ok: true, t: 'Označeno jako v pořádku.' }); router.refresh(); })}
          onUndo={(f) => { if (!f.eventId) return; if (f.listing) undo(f.eventId); else setModal({ t: 'undo', id: f.eventId }); }}
          onOpen={(f) => { if (f.listing) { setKind('all'); setSel(f.listing); } else if (f.eventId) setModal({ t: 'event', id: f.eventId }); }} />
      ) : (
        <>
          <div className="hrw">
            <label className="inp hinp">{HI.search}<input placeholder="Hledat kartu, objednávku nebo změnu" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            {shop && people.length ? (
              <span className="inp hsel"><select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Kdo">
                <option value="">Kdokoli</option>{people.map((p) => <option key={p} value={p}>{p}</option>)}
              </select></span>
            ) : null}
            {shop && places.length ? (
              <span className="inp hsel"><select value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Místo">
                <option value="">Všechna místa</option>{places.map((p) => <option key={p} value={p}>{p}</option>)}
              </select></span>
            ) : null}
          </div>
          {split ? (
            <div className="split">
              {table}
              <CardPanel key={sel} listing={sel!} shop={shop} onClose={() => setSel(null)}
                stockHref={(name) => { const p = new URLSearchParams({ hledat: name }); if (obchod) p.set('obchod', obchod); return `/prodat?${p.toString()}`; }} />
            </div>
          ) : table}
          <small className="hnote">Klik na řádek otevře detail: u karty její historii, u hromadné změny seznam všech karet. Historie se uchovává 12 měsíců.</small>
        </>
      )}

      {msg ? <div className={`toast${msg.ok ? '' : ' err'}`} role="status">{msg.t}</div> : null}
      {modal?.t === 'event' ? <EventModal id={modal.id} canUndo={canUndo} onClose={() => setModal(null)} onUndo={() => setModal({ t: 'undo', id: modal.id })} /> : null}
      {modal?.t === 'undo' ? <UndoModal id={modal.id} onClose={() => setModal(null)}
        onDone={(t, ok) => { setModal(null); setMsg({ ok, t }); router.refresh(); }} /> : null}
      {watch && data.rules ? <WatchModal rules={data.rules} lead={data.lead} owner={owner} hoursText={data.hoursText} onClose={() => setWatch(false)}
        onSaved={() => { setWatch(false); setMsg({ ok: true, t: 'Uloženo. Pravidla platí pro nové změny.' }); router.refresh(); }} /> : null}
    </div>
  );
}

function Thumbs({ e }: { e: HEntry }) {
  if (e.thumbs.length > 1 || (e.multi > 1 && e.thumbs.length)) {
    return <span className="stack">{e.thumbs.slice(0, 3).map((t, i) => <img key={i} src={t} alt="" loading="lazy" />)}</span>;
  }
  if (e.thumbs[0]) return <img className="thumb" src={e.thumbs[0]} alt="" loading="lazy" />;
  return <span className="nothumb">{HI[e.icon as HIcon] ?? HI.stock}</span>;
}

function FlagsView({ flags, view, setView, counts, lead, canUndo, pending, onWatch, onOk, onUndo, onOpen }: {
  flags: HFlag[]; view: 'wait' | 'done'; setView: (v: 'wait' | 'done') => void; counts: [number, number]; lead: boolean; canUndo: boolean; pending: boolean;
  onWatch: () => void; onOk: (f: HFlag) => void; onUndo: (f: HFlag) => void; onOpen: (f: HFlag) => void;
}) {
  const [page, setPage] = useState(1);
  const [extra, setExtra] = useState(0);
  useEffect(() => { setPage(1); setExtra(0); }, [view]);
  const pages = Math.max(1, Math.ceil(flags.length / PAGE));
  const shown = flags.slice((page - 1) * PAGE, (page + extra) * PAGE);
  const to = Math.min(flags.length, (page + extra) * PAGE);
  const done = view === 'done';
  return (
    <>
      <div className="hrw">
        <div className="seg" role="group" aria-label="Stav">
          <button type="button" className={done ? '' : 'on'} onClick={() => setView('wait')}>Čeká na prověření <span className="mono" style={{ fontSize: 12 }}>{counts[0]}</span></button>
          <button type="button" className={done ? 'on' : ''} onClick={() => setView('done')}>Vyřešené <span className="mono" style={{ fontSize: 12 }}>{counts[1]}</span></button>
        </div>
        <span className="hsp" />
        <button type="button" className="btn" onClick={onWatch}>Co hlídat</button>
      </div>
      {!flags.length ? (
        <div className="htbl hempty">
          <span className="ic" style={{ '--c': 'var(--up)', width: 44, height: 44 } as React.CSSProperties}>{HI.check}</span>
          <b>{done ? 'Zatím nic vyřešeného' : 'Nic nečeká na prověření'}</b>
          <small>{done ? 'Tady budou neobvyklé změny, které někdo označil jako v pořádku nebo vrátil.' : 'Za vybrané období se nestalo nic neobvyklého.'}</small>
        </div>
      ) : (
        <div className="htbl" style={{ '--cols': done ? '96px 28px 32px minmax(0,1fr) 110px 120px 230px 28px' : '96px 28px 32px minmax(0,1fr) 110px 120px 230px' } as React.CSSProperties}>
          <div className="th"><span>Kdy</span><span /><span /><span>Co se stalo</span><span className="c">Dopad</span><span className="c">Kdo</span>{done ? <><span>Jak se vyřešilo</span><span /></> : <span />}</div>
          {shown.map((f) => (
            <div key={f.id} className="tr click" role="button" tabIndex={0} onClick={() => onOpen(f)} onKeyDown={(k) => { if (k.key === 'Enter') onOpen(f); }}>
              <span className="tm">{whenShort(f.at)}</span>
              <span className="ic" style={{ '--c': done ? (f.resolution === 'undone' ? 'var(--c-stock)' : 'var(--up)') : 'var(--down)' } as React.CSSProperties}>
                {done ? (f.resolution === 'undone' ? HI.undo : HI.check) : HI.warn}
              </span>
              {f.thumb ? <img className="thumb" src={f.thumb} alt="" loading="lazy" /> : <span className="nothumb">{HI.stock}</span>}
              <span className="tx"><span className="ttl">{f.title}{f.tag && !done ? <span className="tag w">{f.tag}</span> : null}</span>{f.detail ? <small>{f.detail}</small> : null}</span>
              <span className={`imp ${f.impact == null ? '' : f.impact < 0 ? 'dn' : 'up'}`}>{f.impact ? `${f.impact < 0 ? '▼' : '▲'} ${fmtKc(Math.abs(f.impact))}` : ''}</span>
              <span className="who">{f.who ? <><span className="av">{f.who[0]?.toUpperCase()}</span>{f.who}</> : <span className="auto">Automaticky</span>}</span>
              {done ? (
                <>
                  <span className="tx" style={{ alignItems: 'flex-start' }}>
                    <span className={`tag ${f.resolution === 'ok' ? 'u' : f.resolution === 'auto' ? 'i' : 'n'}`}>{f.resolution === 'ok' ? 'V pořádku' : f.resolution === 'auto' ? 'Vyřešilo se samo' : 'Vráceno'}</span>
                    <small>{[f.resolvedBy, f.resolvedAt ? whenShort(f.resolvedAt) : null, f.note ? `„${f.note}“` : null].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="acts"><span className="chev" aria-hidden="true">{HI.right}</span></span>
                </>
              ) : (
                <span className="acts" onClick={(x) => x.stopPropagation()}>
                  {lead ? <button type="button" className="btn sm ub2" disabled={pending} onClick={() => onOk(f)}>V pořádku</button> : null}
                  {f.undoLabel && canUndo ? <button type="button" className="btn sm ub3" disabled={pending} onClick={() => onUndo(f)}>{f.undoLabel}</button> : null}
                </span>
              )}
            </div>
          ))}
          <div className="hfoot">
            <span className="fl mono">{(page - 1) * PAGE + 1}–{to} z {flags.length}</span>
            <Pager page={page + extra} pages={pages} onPage={(p) => { setPage(p); setExtra(0); }} />
            <span className="fr">{to < flags.length ? <button type="button" className="more" onClick={() => setExtra((x) => x + 1)}>Zobrazit dalších {Math.min(PAGE, flags.length - to)}{HI.down}</button> : null}</span>
          </div>
        </div>
      )}
      {!done ? <small className="hnote">Vyřešené zůstanou v Historii s tím, kdo je označil a kdy.{lead ? '' : ' Označit jako v pořádku může vedoucí.'}</small> : null}
    </>
  );
}
