'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, CardThumb, Status } from '@/components/trezor';
import { formatPrice } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { CONDITIONS } from '@/lib/types';
import { removeWant, saveWant } from './actions';

export interface Want {
  cardId: string;
  slug: string;
  name: string;
  number: string;
  image: string | null;
  game: string | null;
  setCode: string;
  setName: string;
  maxPrice: number | null;
  minCondition: string;
  low: number | null;
  offers: number;
}

/** Hledám: karty, které sběratel shání, s nejlevnější nabídkou ve stavu stejném nebo lepším. */
export function WantsList({ wants }: { wants: Want[] }) {
  const [only, setOnly] = useState(false);
  const hits = wants.filter((w) => w.low != null && (w.maxPrice == null || w.low <= w.maxPrice));
  const list = only ? hits : wants;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="tz-stk-strip">
        <button type="button" onClick={() => setOnly(false)}><small>Hledám</small><b>{wants.length}</b><em>karet</em></button>
        <button type="button" onClick={() => setOnly(true)}><small>Za vaši cenu</small><b>{hits.length}</b><em>teď v nabídce</em></button>
      </div>
      {list.length ? (
        <div className="tz-table-wrap">
          <table className="tz-table">
            <thead><tr><th>Karta</th><th>Nejhorší stav</th><th className="tz-num">Nejvýš za</th><th className="tz-num">Nejlevnější nabídka</th><th /></tr></thead>
            <tbody>{list.map((w) => <WantRow key={w.cardId} w={w} />)}</tbody>
          </table>
        </div>
      ) : (
        <div className="tz-stk-empty"><b>{only ? 'Žádná hledaná karta teď není za vaši cenu' : 'Zatím nic nehledáte'}</b>Kartu přidáte vyhledáním výše.</div>
      )}
    </div>
  );
}

function WantRow({ w }: { w: Want }) {
  const [max, setMax] = useState(w.maxPrice != null ? String(w.maxPrice) : '');
  const [cond, setCond] = useState(w.minCondition);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const dirty = max !== (w.maxPrice != null ? String(w.maxPrice) : '') || cond !== w.minCondition;
  const hit = w.low != null && (w.maxPrice == null || w.low <= w.maxPrice);
  return (
    <tr>
      <td>
        <span className="tz-stk-card">
          <CardThumb size="sm" image={thumbUrl(w.image ?? undefined)} preview={w.image ?? undefined} color={w.game ? `var(--game-${w.game}-art, var(--surface-sunken))` : undefined} />
          <span><b><Link href={`/karty/${w.slug}`}>{w.name}</Link></b><small>{w.setName} · <span className="tz-stk-code">{w.setCode} {w.number}</span></small></span>
        </span>
      </td>
      <td>
        <select className="tz-stk-select" value={cond} onChange={(e) => setCond(e.target.value)} aria-label="Nejhorší stav">
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td className="tz-num">
        <input className="tz-cell-input tz-num" style={{ width: 84 }} inputMode="numeric" placeholder="Kč" aria-label="Nejvyšší cena" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} />
      </td>
      <td className="tz-num">
        {w.low != null ? <>{formatPrice(w.low)} {hit ? <Status tone="ok">Za vaši cenu</Status> : null}</> : <span className="tz-stk-muted">Teď nikdo nenabízí</span>}
        {err ? <div className="tz-stk-down t-small">{err}</div> : null}
      </td>
      <td className="tz-num">
        <span className="tz-stk-hacts" style={{ justifyContent: 'flex-end' }}>
          {dirty ? <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await saveWant(w.cardId, max ? Number(max) : null, cond); setErr(r.error ?? ''); })}>Uložit</Button> : null}
          {w.offers ? <Link className="tz-btn tz-btn-secondary tz-btn-sm" href={`/karty/${w.slug}`}>Nabídky ({w.offers})</Link> : null}
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { const r = await removeWant(w.cardId); setErr(r.error ?? ''); })}>Už nehledám</Button>
        </span>
      </td>
    </tr>
  );
}

/** Přidání hledané karty (karta vybraná vyhledáním). */
export function WantForm({ cardId, done }: { cardId: string; done: string }) {
  const [max, setMax] = useState('');
  const [cond, setCond] = useState('EX');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="tz-stk-tools">
      <label className="tz-stk-field">Nejhorší stav
        <select className="tz-stk-select" value={cond} onChange={(e) => setCond(e.target.value)}>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
      </label>
      <label className="tz-stk-field">Nejvýš za (Kč, nepovinné)
        <input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} />
      </label>
      <Button disabled={pending} onClick={() => start(async () => {
        const r = await saveWant(cardId, max ? Number(max) : null, cond);
        setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: done });
      })}>Přidat do Hledám</Button>
      {msg ? <p className={`tz-stk-msg ${msg.ok ? 'is-ok' : 'is-err'}`} role="status">{msg.text}</p> : null}
    </div>
  );
}

/** Tlačítko u chybějící karty sady: přidat do Hledám. */
export function WantButton({ cardId, wanted }: { cardId: string; wanted: boolean }) {
  const [done, setDone] = useState(wanted);
  const [pending, start] = useTransition();
  return done ? <span className="t-small muted">V Hledám</span> : (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { const r = await saveWant(cardId, null, 'EX'); if (!r.error) setDone(true); })}>Hledám</Button>
  );
}
