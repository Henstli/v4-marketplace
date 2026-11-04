'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { thumbUrl } from '@/lib/images';
import { removeWant, saveWant } from './actions';
import { addSearch, type FoundCard } from './sk-actions';
import { kc, Modal, Seg } from './sk';

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

const offers = (n: number) => `${n} ${n === 1 ? 'nabídka' : n < 5 ? 'nabídky' : 'nabídek'}`;

/** Hledám podle prototypu: Dostupné za vaši cenu a Hlídám, přidání oknem. */
export function WantsView({ wants }: { wants: Want[] }) {
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ok = (w: Want) => w.low != null && (w.maxPrice == null || w.low <= w.maxPrice);
  const A = wants.filter(ok), B = wants.filter((w) => !ok(w));
  const row = (w: Want) => (
    <div key={w.cardId} className="wnr">
      {w.image ? <img src={thumbUrl(w.image)} alt="" /> : <img alt="" />}
      <span><b><Link href={`/karty/${w.slug}`}>{w.name}</Link></b><small className="mono">{w.setCode} {w.number} · od {w.minCondition}</small></span>
      {edit === w.cardId ? (
        <span className="wnm"><small>Chci do</small>
          <input className="pin" autoFocus defaultValue={w.maxPrice ?? ''} inputMode="numeric" style={{ width: 90, font: '600 14px var(--fm)', background: 'var(--surface-sunken)', border: '1px solid var(--accent)', borderRadius: 6, padding: '2px 6px' }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEdit(null);
              if (e.key === 'Enter') { const v = Number((e.target as HTMLInputElement).value.replace(/\D/g, '')) || null; setEdit(null); start(async () => { await saveWant(w.cardId, v, w.minCondition); router.refresh(); }); }
            }} onBlur={() => setEdit(null)} />
        </span>
      ) : (
        <span className="wnm" title="Změnit" onClick={() => setEdit(w.cardId)} style={{ cursor: 'pointer' }}><small>Chci do</small><b className="mono">{w.maxPrice != null ? kc(w.maxPrice) : 'tržní cena'}</b></span>
      )}
      <span className="wnl"><small>Nejlevněji teď</small>{w.low == null ? <b className="mut">nikdo neprodává</b> : <b className={`mono${ok(w) ? ' acc' : ''}`}>{kc(w.low)}</b>}
        <small>{w.offers ? offers(w.offers) : 'dáme vědět, až se objeví'}</small></span>
      <span className="wna">
        {ok(w) ? <Link className="btn sm p" href={`/karty/${w.slug}`}>Zobrazit nabídky</Link> : null}
        <button type="button" className="btn sm g lcdl" disabled={pending} onClick={() => start(async () => { await removeWant(w.cardId); router.refresh(); })}>Odebrat</button>
      </span>
    </div>
  );
  return (
    <>
      <div className="wnh">
        <p className="ilead" style={{ margin: 0 }}>Karty, které sháníte. Hlídáme ceny a dáme vědět, když se objeví nabídka za vaši cenu. Celé sady najdete v Chybí do sad.</p>
        <button type="button" className="btn p" onClick={() => setAdd(true)}>+ Přidat kartu</button>
      </div>
      {A.length ? <><div className="wng acc">Dostupné za vaši cenu <span>{A.length}</span></div><div className="olist">{A.map(row)}</div></> : null}
      <div className="wng">Hlídám <span>{B.length}</span></div>
      <div className="olist">{B.length ? B.map(row) : <div className="none">{wants.length ? 'Nic dalšího nehlídáte.' : 'Zatím nic nehledáte. Kartu přidáte tlačítkem + Přidat kartu.'}</div>}</div>
      <small className="wsm" style={{ display: 'block', marginTop: 10 }}>Když kartu přidáte do sbírky, můžete ji ze seznamu odebrat.</small>
      {add ? <AddWant onClose={() => { setAdd(false); router.refresh(); }} /> : null}
    </>
  );
}

function AddWant({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<FoundCard[]>([]);
  const [max, setMax] = useState('');
  const [cond, setCond] = useState('EX');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim().length >= 2) addSearch(q).then(setRes).catch(() => setRes([])); else setRes([]); }, 220);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal title="Přidat do Hledám" onClose={onClose} foot={<button type="button" className="btn" onClick={onClose}>Hotovo</button>}>
      <div>
        <div className="inp"><input autoFocus value={q} placeholder="Název, sada nebo číslo karty" style={{ font: '500 14px var(--fs)' }} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="umal" style={{ marginTop: 12 }}>
          {res.length ? res.map((c) => (
            <div key={c.id} className="umar">
              {c.image ? <img src={c.image} alt="" /> : <img alt="" />}
              <span><b>{c.name}</b><small className="mono">{c.set}{c.game ? ` · ${c.game}` : ''}</small></span>
              {added.has(c.id) ? <span className="usrc">V Hledám</span> : (
                <button type="button" className="btn sm" disabled={pending} onClick={() => start(async () => {
                  const r = await saveWant(c.id, max ? Number(max) : null, cond);
                  if (r.error) setErr(r.error); else setAdded((s) => new Set(s).add(c.id));
                })}>Přidat</button>
              )}
            </div>
          )) : <div className="umar"><span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{q.trim().length >= 2 ? 'Nic nenalezeno' : 'Napište název karty'}</span></div>}
        </div>
      </div>
      <div className="grid2">
        <div className="f"><label>Chci zaplatit nejvýš</label><div className="inp"><input value={max} placeholder="Prázdné = tržní cena" onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} /><em>Kč</em></div></div>
        <div className="f"><label>Nejhorší stav</label><Seg value={cond} onChange={setCond} options={[['NM', 'NM'], ['EX', 'EX'], ['LP', 'LP']]} /></div>
      </div>
      {err ? <small style={{ color: 'var(--down)' }}>{err}</small> : null}
    </Modal>
  );
}

/** Tlačítko u chybějící karty sady: hlídat cenu (přidat do Hledám). */
export function WantButton({ cardId, wanted }: { cardId: string; wanted: boolean }) {
  const [done, setDone] = useState(wanted);
  const [pending, start] = useTransition();
  return done ? <span className="btn sm g" style={{ color: 'var(--accent)' }}>Hlídáte</span> : (
    <button type="button" className="btn sm g" disabled={pending} onClick={() => start(async () => { const r = await saveWant(cardId, null, 'EX'); if (!r.error) setDone(true); })}>Hlídat cenu</button>
  );
}
