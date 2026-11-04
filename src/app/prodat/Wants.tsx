'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { thumbUrl } from '@/lib/images';
import { removeWant, saveWant } from './actions';
import { addSearch, type FoundCard } from './sk-actions';
import { CONDITIONS, CONDITION_NAMES, type Condition } from '@/lib/types';
import { Ico, kc, Modal, Seg } from './sk';

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
  minCondition: string | null;
  low: number | null;
  offers: number;
  /** Nové upozornění, které uživatel ještě neviděl */
  fresh?: boolean;
}

const offers = (n: number) => `${n} ${n === 1 ? 'nabídka' : n < 5 ? 'nabídky' : 'nabídek'}`;

/** Hlídané karty (Hlídání a příkazy): Dostupné za vaši cenu a Hlídám, přidání oknem. */
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
      <span><b>{w.fresh ? <span className="wnew">Nové</span> : null}<Link href={`/karty/${w.slug}`}>{w.name}</Link></b><small className="mono">{w.setCode} {w.number} · {w.minCondition && w.minCondition !== 'PL' ? `${w.minCondition} a lepší` : 'jakýkoli stav'}</small></span>
      {edit === w.cardId ? (
        <span className="wnm"><small>Chci do</small>
          <input className="pin" autoFocus defaultValue={w.maxPrice ?? ''} inputMode="numeric" style={{ width: 90, font: '600 14px var(--fm)', background: 'var(--surface-sunken)', border: '1px solid var(--accent)', borderRadius: 6, padding: '2px 6px' }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEdit(null);
              if (e.key === 'Enter') { const v = Number((e.target as HTMLInputElement).value.replace(/\D/g, '')) || null; setEdit(null); start(async () => { await saveWant(w.cardId, v, w.minCondition ?? 'PL'); router.refresh(); }); }
            }} onBlur={() => setEdit(null)} />
        </span>
      ) : (
        <span className="wnm" title="Změnit" onClick={() => setEdit(w.cardId)} style={{ cursor: 'pointer' }}><small>Chci do</small><b className="mono">{w.maxPrice != null ? kc(w.maxPrice) : 'bez limitu'}</b></span>
      )}
      <span className="wnl"><small>{w.low == null ? 'Nabídky' : 'Nejlevněji teď'}</small>{w.low == null ? <b className="mut">zatím žádné</b> : <b className={`mono${ok(w) ? ' acc' : ''}`}>{kc(w.low)}</b>}
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
        <p className="ilead" style={{ margin: 0 }}>Karty, které sháníte. Jakmile se objeví nabídka za vaši cenu a ve vašem stavu, pošleme e-mail. Hlídat jde i u karty tlačítkem „Dát vědět, až se objeví nabídka“ a ve Sbírce v Chybí do sad.</p>
        <button type="button" className="btn p" onClick={() => setAdd(true)}>+ Hlídat kartu</button>
      </div>
      {A.length ? <><div className="wng acc">Dostupné za vaši cenu <span>{A.length}</span></div><div className="olist">{A.map(row)}</div></> : null}
      <div className="wng">Hlídám <span>{B.length}</span></div>
      <div className="olist">{B.length ? B.map(row) : <div className="none">{wants.length ? 'Nic dalšího nehlídáte.' : 'Zatím nic nehlídáte. Kartu přidáte tlačítkem + Hlídat kartu.'}</div>}</div>
      {add ? <AddWant onClose={() => { setAdd(false); router.refresh(); }} /> : null}
    </>
  );
}

const CONDS = CONDITIONS;
/** „EX a lepší“: všechny stavy od Mint po zvolený. */
const condHint = (c: string) => {
  const k = CONDS.indexOf(c as never);
  return k <= 0 ? 'Jen Mint' : `${CONDITION_NAMES[c as Condition]} a lepší (${CONDS.slice(0, k + 1).join(', ')})`;
};

/** Hlídat kartu: najít kartu, vybrat ji, nastavit cenu a stav, přidat. Pak jde hledat další. */
function AddWant({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<FoundCard[] | null>(null);
  const [sel, setSel] = useState<FoundCard | null>(null);
  const [max, setMax] = useState('');
  const [cond, setCond] = useState('EX');
  const [done, setDone] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim().length >= 2) addSearch(q).then(setRes).catch(() => setRes([])); else setRes(null); }, 220);
    return () => clearTimeout(t);
  }, [q]);
  const add = () => sel && start(async () => {
    const r = await saveWant(sel.id, max ? Number(max) : null, cond);
    if (r.error) { setErr(r.error); return; }
    setErr(''); setDone((d) => [sel.name, ...d]); setSel(null); setQ(''); setRes(null); setMax('');
  });
  return (
    <Modal title="Hlídat kartu" onClose={onClose} foot={<>
      {done.length ? <span className="note">Přidáno: {done.slice(0, 2).join(', ')}{done.length > 2 ? ` a ${done.length - 2} další` : ''}</span> : null}
      <button type="button" className="btn" onClick={onClose}>{done.length ? 'Hotovo' : 'Zrušit'}</button>
      <button type="button" className="btn p" disabled={!sel || pending} onClick={add}>Hlídat kartu</button>
    </>}>
      <div className="wadd">
        <div className="wst"><span className="n">1</span>Karta</div>
        {sel ? (
          <div className="wsel">
            {sel.image ? <img src={sel.image} alt="" /> : <img alt="" />}
            <span><b>{sel.name}</b><small className="mono">{sel.set}{sel.game ? ` · ${sel.game}` : ''}</small></span>
            <button type="button" className="btn sm g" onClick={() => setSel(null)}>Změnit</button>
          </div>
        ) : (
          <>
            <div className="inp">{Ico.s}<input autoFocus value={q} placeholder="Název, sada nebo číslo karty" onChange={(e) => setQ(e.target.value)} /></div>
            {res ? (
              <div className="umal wres">
                {res.length ? res.map((c) => (
                  <button key={c.id} type="button" className="umar" onClick={() => setSel(c)}>
                    {c.image ? <img src={c.image} alt="" /> : <img alt="" />}
                    <span><b>{c.name}</b><small className="mono">{c.set}{c.game ? ` · ${c.game}` : ''}</small></span>
                    <span className="wpick">Vybrat</span>
                  </button>
                )) : <div className="umar"><span className="wmut">Nic nenalezeno. Zkuste jiný název nebo číslo.</span></div>}
              </div>
            ) : null}
          </>
        )}
        <div className={`wset${sel ? '' : ' off'}`}>
          <div className="wst"><span className="n">2</span>Za kolik a v jakém stavu</div>
          <div className="f"><label>Zaplatím nejvýš</label>
            <div className="inp"><input value={max} inputMode="numeric" placeholder="Bez limitu" onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} /><em>Kč</em></div>
          </div>
          <div className="f"><label>Nejhorší stav, který beru</label>
            <Seg value={cond} onChange={setCond} options={CONDS.map((c) => [c, c] as [string, string])} />
            <small className="wmut">{condHint(cond)}</small>
          </div>
        </div>
        {err ? <small style={{ color: 'var(--down)' }}>{err}</small> : null}
      </div>
    </Modal>
  );
}

/** Tlačítko u chybějící karty sady: hlídat cenu (přidat do Hlídaných karet). */
export function WantButton({ cardId, wanted }: { cardId: string; wanted: boolean }) {
  const [done, setDone] = useState(wanted);
  const [pending, start] = useTransition();
  return done ? <span className="btn sm g" style={{ color: 'var(--accent)' }}>Hlídáte</span> : (
    <button type="button" className="btn sm g" disabled={pending} onClick={() => start(async () => { const r = await saveWant(cardId, null, 'EX'); if (!r.error) setDone(true); })}>Hlídat cenu</button>
  );
}
