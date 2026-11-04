'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/trezor';
import { fold } from '@/lib/import/columns';
import { formatDateTime } from '@/lib/format';
import { stockUndo } from './actions';

export interface HistoryEntry {
  key: string;
  kind: 'sale' | 'stock' | 'price' | 'sync';
  title: string;
  detail?: string | null;
  at: string;
  /** Změna skladu, kterou jde vrátit */
  eventId?: number;
  canUndo?: boolean;
  undone?: boolean;
  /** Ukázka změn: [název, před, po] */
  sample?: [string, string, string][] | null;
  href?: string;
}

const KINDS: { k: HistoryEntry['kind'] | 'all'; label: string }[] = [
  { k: 'all', label: 'Vše' },
  { k: 'sale', label: 'Prodeje' },
  { k: 'stock', label: 'Sklad' },
  { k: 'price', label: 'Ceny' },
];
const ICON: Record<HistoryEntry['kind'], string> = { sale: 'P', stock: 'S', price: 'Kč', sync: 'E' };

/** Historie skladu: co se změnilo, filtry podle typu, Detail u hromadných změn a Vrátit (ne u prodejů). */
export function StockHistory({ entries, shop }: { entries: HistoryEntry[]; shop: boolean }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]['k']>('all');
  const [q, setQ] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entries.length };
    for (const e of entries) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [entries]);
  const list = useMemo(() => {
    const t = fold(q);
    return entries.filter((e) => (kind === 'all' || e.kind === kind)
      && (!t || fold([e.title, e.detail, ...(e.sample ?? []).map((s) => s[0])].filter(Boolean).join(' ')).includes(t)));
  }, [entries, kind, q]);

  function undo(e: HistoryEntry) {
    if (!e.eventId) return;
    if (!window.confirm(`Vrátit změnu „${e.title}“? Ceny, výměna a umístění se vrátí, kusy jen o to, o kolik je změna změnila.`)) return;
    setMsg(null);
    start(async () => {
      const res = await stockUndo(e.eventId!);
      setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: 'Změna je vrácená.' });
    });
  }

  function csv() {
    const rows = [['Kdy', 'Typ', 'Změna', 'Podrobnosti', 'Vráceno'], ...list.map((e) => [
      formatDateTime(e.at), KINDS.find((k) => k.k === e.kind)?.label ?? e.kind, e.title, e.detail ?? '', e.undone ? 'ano' : '',
    ])];
    const text = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = `v4cards-historie-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="tz-stk-tools">
        {KINDS.map((k) => (
          <button key={k.k} type="button" className="tz-stk-fbtn" aria-pressed={kind === k.k} onClick={() => setKind(k.k)}>
            {k.label === 'Sklad' && !shop ? 'Sbírka' : k.label}<span className="tz-stk-muted">{counts[k.k] ?? 0}</span>
          </button>
        ))}
        <input className="tz-stk-search" type="search" placeholder="Hledat v historii: karta nebo změna" aria-label="Hledat v historii" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="ghost" onClick={csv} disabled={!list.length}>Stáhnout CSV</Button>
      </div>
      {msg ? <p className={`tz-stk-msg ${msg.ok ? 'is-ok' : 'is-err'}`} role="status">{msg.text}</p> : null}
      {list.length ? (
        <div className="tz-stk-hist">
          {list.map((e) => (
            <div key={e.key} className={`tz-stk-hrow${e.undone ? ' is-undone' : ''}`}>
              <time dateTime={e.at}>{formatDateTime(e.at)}</time>
              <span className={`tz-stk-hi k-${e.kind}`} aria-hidden="true">{ICON[e.kind]}</span>
              <div>
                {e.title}
                {e.detail || e.undone ? <small>{[e.detail, e.undone ? 'Vráceno' : null].filter(Boolean).join(' · ')}</small> : null}
              </div>
              <span className="tz-stk-hacts">
                {e.sample?.length ? <Button variant="ghost" size="sm" onClick={() => setOpenKey(openKey === e.key ? null : e.key)}>{openKey === e.key ? 'Skrýt' : 'Detail'}</Button> : null}
                {e.href ? <Link className="tz-btn tz-btn-ghost tz-btn-sm" href={e.href}>Otevřít</Link> : null}
                {e.canUndo && !e.undone ? <Button variant="secondary" size="sm" disabled={pending} onClick={() => undo(e)}>Vrátit</Button> : null}
              </span>
              {openKey === e.key && e.sample ? (
                <div className="tz-stk-sample">
                  {e.sample.map(([name, before, after], i) => (
                    <span key={i} style={{ display: 'contents' }}><span>{name}</span><s>{before}</s><span>{after}</span></span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="tz-stk-empty"><b>Zatím tu nic není</b>Sem se zapíše každá změna cen a kusů i každý prodej.</div>
      )}
      <p className="t-small muted">Ukazujeme posledních 12 měsíců. Prodeje vrátit nejde, řeší se v objednávce.</p>
    </div>
  );
}
