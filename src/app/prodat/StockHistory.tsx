'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { fold } from '@/lib/import/columns';
import { stockUndo } from './actions';
import { Ico } from './sk';

export interface HistoryEntry {
  key: string;
  kind: 'sale' | 'stock' | 'price' | 'sync' | 'inv';
  title: string;
  detail?: string | null;
  at: string;
  /** Kdo změnu udělal (jméno), nebo null u automatických */
  who?: string | null;
  /** Změna skladu, kterou jde vrátit */
  eventId?: number;
  canUndo?: boolean;
  undone?: boolean;
  /** Ukázka změn: [název, před, po] */
  sample?: [string, string, string][] | null;
  href?: string;
}

const HCAT: [HistoryEntry['kind'] | 'all', string][] = [['all', 'Vše'], ['sale', 'Prodeje'], ['stock', 'Sklad'], ['price', 'Ceny'], ['sync', 'Synchronizace'], ['inv', 'Inventura']];
const HCOL: Record<HistoryEntry['kind'], string> = { sale: '#5fd0a8', stock: '#9aa3ad', price: '#f0b35a', sync: '#6aa9ff', inv: '#b58cff' };
const ICO: Record<HistoryEntry['kind'], React.ReactNode> = { sale: Ico.sale, stock: Ico.stock, price: Ico.price, sync: Ico.sync, inv: Ico.inv };

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('cs-CZ');
function dayLabel(iso: string) {
  const d = new Date(iso), t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Dnes';
  if (d.toDateString() === y.toDateString()) return 'Včera';
  return d.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });
}

/** Historie podle prototypu: štítky typů s počty, hledání, dny, Detail, Otevřít a Vrátit. */
export function StockHistory({ entries, shop }: { entries: HistoryEntry[]; shop: boolean }) {
  const [kind, setKind] = useState<HistoryEntry['kind'] | 'all'>('all');
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();

  const people = useMemo(() => [...new Set(entries.map((e) => e.who).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'cs')), [entries]);
  const cats = HCAT.filter(([k]) => shop || k !== 'inv').filter(([k]) => k === 'all' || k !== 'sync' || entries.some((e) => e.kind === 'sync'));
  const list = useMemo(() => {
    const t = fold(q);
    return entries.filter((e) => (kind === 'all' || e.kind === kind) && (!who || e.who === who)
      && (!t || fold([e.title, e.detail, ...(e.sample ?? []).map((s) => s[0])].filter(Boolean).join(' ')).includes(t)));
  }, [entries, kind, q, who]);

  const days: [string, HistoryEntry[]][] = [];
  for (const e of list) {
    const k = dayKey(e.at);
    const last = days[days.length - 1];
    if (last && last[0] === k) last[1].push(e); else days.push([k, [e]]);
  }

  function undo(e: HistoryEntry) {
    setConfirm(null);
    start(async () => {
      const r = await stockUndo(e.eventId!);
      setMsg(r.error ? { ok: false, t: r.error } : { ok: true, t: 'Změna je vrácená.' });
    });
  }
  function csv() {
    const rows = [['Kdy', 'Typ', 'Změna', 'Podrobnosti', 'Kdo', 'Vráceno'], ...list.map((e) => [
      new Date(e.at).toLocaleString('cs-CZ'), HCAT.find((k) => k[0] === e.kind)?.[1] ?? e.kind, e.title, e.detail ?? '', e.who ?? '', e.undone ? 'ano' : '',
    ])];
    const text = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = `v4cards-historie-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <div className="hst">
        <div className="bar" style={{ margin: 0 }}>
          {cats.map(([k, t]) => (
            <button key={k} type="button" className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
              {!shop && k === 'stock' ? 'Sbírka' : t} <span style={{ opacity: 0.6 }}>{k === 'all' ? entries.length : entries.filter((e) => e.kind === k).length}</span>
            </button>
          ))}
        </div>
        <div className="hst2">
          <div className="inp hsq">{Ico.s}<input placeholder="Hledat kartu nebo změnu" value={q} onChange={(e) => setQ(e.target.value)} style={{ font: '500 13.5px var(--fs)' }} /></div>
          {shop && people.length > 1 ? (
            <div className="inp" style={{ width: 220 }}>
              <select value={who} onChange={(e) => setWho(e.target.value)} style={{ background: 'none', border: 0, flex: 1, font: '500 13.5px var(--fs)' }} aria-label="Kdo">
                <option value="">Kdokoli</option>
                {people.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          ) : null}
          <button type="button" className="btn sm" disabled={!list.length} onClick={csv}>Stáhnout CSV</button>
        </div>
      </div>
      {msg ? <div className={`toast${msg.ok ? '' : ' err'}`} role="status">{msg.t}</div> : null}
      <div className="tbl">
        {days.length ? days.map(([k, L]) => (
          <div key={k}>
            <div className="hday">{dayLabel(L[0].at)}</div>
            {L.map((e) => {
              const op = open.has(e.key);
              return (
                <div key={e.key}>
                  <div className={`hrow2${e.undone ? ' hun' : ''}`}>
                    <span className="t mono">{new Date(e.at).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="hi2" style={{ '--c': HCOL[e.kind] } as React.CSSProperties}>{ICO[e.kind]}</span>
                    <span className="hx"><span>{e.title}{e.undone ? <> <span className="usrc">Vráceno</span></> : null}</span>{e.detail ? <small>{e.detail}</small> : null}</span>
                    <span className="hwh">{shop ? (e.who ? <><span className="av">{e.who[0]?.toUpperCase()}</span>{e.who}</> : <span className="hauto">Automaticky</span>) : null}</span>
                    <span className="hac">
                      {e.sample?.length ? <button type="button" className="btn sm g" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(e.key)) n.delete(e.key); else n.add(e.key); return n; })}>{op ? 'Skrýt' : 'Detail'}</button> : null}
                      {e.href ? <Link className="btn sm g" href={e.href}>Otevřít</Link> : null}
                      {e.canUndo && !e.undone ? (confirm === e.key
                        ? <button type="button" className="btn sm p" disabled={pending} onClick={() => undo(e)}>Opravdu vrátit</button>
                        : <button type="button" className="btn sm" onClick={() => setConfirm(e.key)}>Vrátit</button>) : null}
                    </span>
                  </div>
                  {op && e.sample ? (
                    <div className="hdet">
                      {e.sample.map(([n, a, b], i) => <div key={i}><span>{n}</span><span className="mono">{a} → <b>{b}</b></span></div>)}
                      {e.sample.length >= 20 ? <small>a další, celý seznam je ve staženém CSV</small> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )) : <div className="none">{entries.length ? 'Nic neodpovídá filtru.' : 'Zatím tu nic není. Sem se zapíše každá změna cen a kusů i každý prodej.'}</div>}
      </div>
      <small className="wsm" style={{ display: 'block', marginTop: 10 }}>Historie se uchovává 12 měsíců. Vrátit jde změny cen, počtů a umístění, prodeje ne.</small>
    </>
  );
}
