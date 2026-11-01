'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ViewToggle } from './ViewToggle';

export interface ItemRow {
  name: string;
  slug: string | null;
  set: string;
  cond: string | null;
  qty: number;
  price: number;
  img?: string;
  color?: string;
  game: string | null;
}

const kc = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`;
const FIRST = 10;
const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const GAME: Record<string, string> = { pokemon: 'Pokémon', magic: 'Magic', mtg: 'Magic', riftbound: 'Riftbound', lorcana: 'Lorcana', onepiece: 'One Piece', 'one-piece': 'One Piece', cyberpunk: 'Cyberpunk', sport: 'Sport', hockey: 'Sport' };
const kusy = (n: number) => `${n} ${n === 1 ? 'karta' : n <= 4 ? 'karty' : 'karet'}`;
const druhy = (n: number) => `${n} ${n === 1 ? 'druh' : n <= 4 ? 'druhy' : 'druhů'}`;

/**
 * Karty v detailu objednávky (DS Orders › Karty): S náhledy / Jen text, u velké objednávky hledání,
 * filtr her a prvních 10 druhů. Prodejce při balení odškrtává (pamatuje si jen prohlížeč) a kopíruje seznam.
 */
export function OrderItems({ orderId, items, pack, sums }: {
  orderId: string;
  items: ItemRow[];
  /** Prodejce balí: zaškrtávátka a Kopírovat seznam. */
  pack: boolean;
  sums: Array<{ label: string; amount: number; total?: boolean }>;
}) {
  const key = `v4-pack-${orderId}`;
  const [packed, setPacked] = useState<number[]>([]);
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const [game, setGame] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!pack) return;
    try { setPacked(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch {}
  }, [key, pack]);
  const toggle = (n: number) => {
    const next = packed.includes(n) ? packed.filter((x) => x !== n) : [...packed, n];
    setPacked(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
  };
  const big = items.length > FIRST;
  const games = useMemo(() => [...new Set(items.map((i) => i.game).filter(Boolean))] as string[], [items]);
  const list = items.map((i, n) => ({ i, n })).filter(({ i }) => (!game || i.game === game) && (!q || `${i.name} ${i.set}`.toLowerCase().includes(q.toLowerCase())));
  const visible = all || q || game ? list : list.slice(0, FIRST);
  const count = items.reduce((s, i) => s + i.qty, 0);
  const copy = () => {
    const text = items.map((i) => `${i.qty}× ${i.name}${i.set ? ` (${i.set})` : ''}${i.cond ? ` ${i.cond}` : ''}`).join('\n');
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  return (
    <section className="tz-ord-box" aria-labelledby="karty">
      <div className="tz-ord-box-h">
        <h2 id="karty">Karty</h2>
        <span className="tz-ord-pill">{kusy(count)} · {druhy(items.length)}</span>
        {pack ? <span className="tz-ord-packed">{packed.filter((n) => n < items.length).length} z {items.length} zabaleno</span> : null}
        <span className="tz-ord-box-tools">
          {pack ? <button type="button" className="tz-btn tz-btn-secondary tz-btn-sm" onClick={copy}>{copied ? 'Zkopírováno' : 'Kopírovat seznam'}</button> : null}
          <ViewToggle target={`items-${orderId}`} />
        </span>
      </div>
      {big ? (
        <div className="tz-ord-itemtools">
          <label className="tz-ord-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat kartu nebo sadu" aria-label="Hledat v kartách objednávky" />
          </label>
          {games.length > 1 ? (
            <div className="tz-ord-games" role="group" aria-label="Hra">
              <button type="button" aria-pressed={!game} onClick={() => setGame('')}>Vše</button>
              {games.map((g) => <button key={g} type="button" aria-pressed={game === g} onClick={() => setGame(g)}>{GAME[g] ?? g} {items.filter((i) => i.game === g).length}</button>)}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="tz-ord-items" id={`items-${orderId}`}>
        {visible.map(({ i, n }) => {
          const on = pack && packed.includes(n);
          return (
            <div key={n} className="tz-ord-it" data-pack={pack ? '' : undefined} data-packed={on ? '' : undefined}>
              {pack ? <button type="button" className="tz-ord-check" aria-pressed={on} aria-label={`Zabaleno: ${i.name}`} onClick={() => toggle(n)}>{on ? CHECK : null}</button> : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i.img ? <img src={i.img} alt="" loading="lazy" decoding="async" /> : <span className="tz-ord-ph" style={{ background: i.color ?? 'var(--surface-sunken)' }} />}
              {i.slug ? <Link href={`/karty/${i.slug}`}>{i.name}{i.set ? <small>{i.set}</small> : null}</Link> : <span className="nm">{i.name}{i.set ? <small>{i.set}</small> : null}</span>}
              <span className="tz-ord-cond">{i.cond ?? ''}</span>
              <span className="tz-ord-qty" data-many={i.qty > 1 ? '' : undefined}>{i.qty}×</span>
              <span className="tz-ord-lp">{kc(i.price)}</span>
            </div>
          );
        })}
        {!visible.length ? <p className="tz-ord-empty">Žádná karta neodpovídá.</p> : null}
      </div>
      {big && !all && !q && !game && list.length > FIRST ? (
        <div className="tz-ord-showall"><button type="button" className="tz-btn tz-btn-secondary tz-btn-sm" onClick={() => setAll(true)}>Zobrazit všech {druhy(items.length)}</button></div>
      ) : null}
      {sums.map((s) => (
        <div key={s.label} className="tz-ord-sumrow" data-total={s.total ? '' : undefined}><span>{s.label}</span><b>{kc(s.amount)}</b></div>
      ))}
    </section>
  );
}
