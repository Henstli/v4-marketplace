'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { thumbUrl } from '@/lib/images';
import { setMissing, watchSet, type MissingCard } from './sk-actions';
import { kc, Modal, nf, Seg } from './sk';

export interface SetCard { id: string; name: string; code: string; owned: number; total: number; images: string[]; lowSum: number; watched: number; missing: number }

/** Chybí do sad podle prototypu: karty sad s postupem, chybějící karty v okně, hlídání cen. */
export function SetsView({ sets }: { sets: SetCard[] }) {
  const [miss, setMiss] = useState<SetCard | null>(null);
  const [watch, setWatch] = useState<SetCard | null>(null);
  if (!sets.length) return <div className="tbl"><div className="none">Zatím tu nic není. Jakmile budete mít ve sbírce kartu, ukážeme, kolik vám chybí do celé sady.</div></div>;
  return (
    <>
      <div className="sets">
        {sets.map((s) => {
          const left = s.total - s.owned;
          const on = s.missing > 0 && s.watched >= s.missing;
          return (
            <div key={s.id} className="setc">
              <div className="sh"><b>{s.name}</b><small>{s.owned} / {s.total}</small></div>
              <div className="prog"><i style={{ width: `${(s.owned / s.total) * 100}%` }} /></div>
              <small>Chybí {nf(left)} {left === 1 ? 'karta' : left < 5 ? 'karty' : 'karet'}{s.lowSum ? ` · doplnit od ${kc(s.lowSum)}` : ''}</small>
              <div className="miss">
                {s.images.map((im) => <img key={im} src={thumbUrl(im)} alt="" />)}
                {left - s.images.length > 0 ? <span>+{left - s.images.length}</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className="btn sm" onClick={() => setMiss(s)}>Zobrazit chybějící</button>
                <button type="button" className="btn sm g" style={on ? { color: 'var(--accent)' } : undefined} onClick={() => setWatch(s)}>{on ? 'Hlídáte ceny' : 'Hlídat ceny'}</button>
              </div>
            </div>
          );
        })}
      </div>
      {miss ? <MissModal s={miss} onClose={() => setMiss(null)} onWatch={() => { setWatch(miss); setMiss(null); }} /> : null}
      {watch ? <WatchModal s={watch} onClose={() => setWatch(null)} /> : null}
    </>
  );
}

function MissModal({ s, onClose, onWatch }: { s: SetCard; onClose: () => void; onWatch: () => void }) {
  const [L, setL] = useState<MissingCard[] | null>(null);
  const [f, setF] = useState<'all' | 'cheap'>('all');
  useEffect(() => { setMissing(s.id).then(setL).catch(() => setL([])); }, [s.id]);
  const V = (L ?? []).filter((x) => f === 'all' || (x.low != null && x.low <= 200));
  const on = s.missing > 0 && s.watched >= s.missing;
  return (
    <Modal title={`Chybí do sady: ${s.name}`} wide onClose={onClose} foot={<>
      <button type="button" className="btn" style={{ marginRight: 'auto' }} onClick={onWatch}>{on ? 'Hlídáte ceny' : 'Hlídat ceny'}</button>
      <button type="button" className="btn p" onClick={onClose}>Zavřít</button>
    </>}>
      <div className="smh"><div className="prog" style={{ flex: 1 }}><i style={{ width: `${(s.owned / s.total) * 100}%` }} /></div><span className="mono">{s.owned} / {s.total}</span></div>
      <div className="bar" style={{ margin: 0 }}>
        {([['all', 'Všechny'], ['cheap', 'Do 200 Kč']] as const).map(([k, t]) => <button key={k} type="button" className={`chip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{t}</button>)}
      </div>
      <div className="olist">
        {L == null ? <div className="none">Načítám…</div> : V.length ? V.map((x) => (
          <div key={x.id} className="smr">
            {x.image ? <img src={x.image} alt="" /> : <img alt="" />}
            <span><b>{x.name}</b><small className="mono">{s.code} {x.number}</small></span>
            <span className="smp">{x.low != null ? <b className="mono">od {kc(x.low)}</b> : <b className="mono" style={{ color: 'var(--ink-muted)' }}>nikdo neprodává</b>}<small>{x.offers} {x.offers === 1 ? 'nabídka' : x.offers > 1 && x.offers < 5 ? 'nabídky' : 'nabídek'}</small></span>
            <Link className="btn sm" href={`/karty/${x.slug}`}>{x.offers ? 'Nabídky' : 'Karta'}</Link>
          </div>
        )) : <div className="none">Nic neodpovídá.</div>}
      </div>
      {L && L.length >= 500 ? <small className="wsm">Ukazujeme prvních 500 chybějících karet od nejlevnější.</small> : null}
    </Modal>
  );
}

function WatchModal({ s, onClose }: { s: SetCard; onClose: () => void }) {
  const on = s.missing > 0 && s.watched >= s.missing;
  const [c, setC] = useState('EX');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (cond: string | null) => start(async () => {
    const r = await watchSet(s.id, cond);
    if (r.error) { setErr(r.error); return; }
    router.refresh();
    onClose();
  });
  return (
    <Modal title={`Hlídat ceny: ${s.name}`} onClose={onClose} foot={<>
      {on ? <button type="button" className="btn" style={{ marginRight: 'auto' }} disabled={pending} onClick={() => go(null)}>Zrušit hlídání</button> : null}
      <button type="button" className="btn" onClick={onClose}>Zavřít</button>
      <button type="button" className="btn p" disabled={pending} onClick={() => go(c)}>{on ? 'Uložit' : 'Hlídat'}</button>
    </>}>
      <p className="ixlead">Hlídáme všech {nf(s.missing)} karet, které vám v sadě chybí. Přidáme je do Hledám a dáme vědět, když se objeví nabídka. Když kartu přidáte do sbírky, můžete ji z Hledám odebrat.</p>
      <div className="sgrp">
        <div className="sgh">Jaké karty</div>
        <div className="srow"><div><b>Nejhorší stav</b><small>Horší kusy vám neukážeme.</small></div>
          <Seg value={c} onChange={setC} style={{ width: 240 }} options={[['NM', 'NM'], ['EX', 'EX'], ['LP', 'LP']]} /></div>
      </div>
      {err ? <small style={{ color: 'var(--down)' }}>{err}</small> : null}
    </Modal>
  );
}
