'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CopyButton } from '@/components/orders/CopyButton';
import { formatDateTime, formatPrice, plural } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';
import { setOrderStatus } from '../objednavky/actions';
import type { ShipOrder } from './ship';
import { Ico } from './sk';

const karet = (n: number) => plural(n, ['karta', 'karty', 'karet']);
const pcs = (o: ShipOrder) => o.items.reduce((s, i) => s + i.qty, 0);
const lang = (l: string | null) => (l ? LANGUAGE_NAMES[l as Language] ?? l : '');
const NO_LOC = 'Bez umístění';
/** Barvy přihrádek (jedna přihrádka = jedna objednávka); číslo v kroužku je vždy vidět, barva jen pomáhá. */
const BIN = ['#5fd0a8', '#6aa9ff', '#f0b35a', '#b58cff', '#ff8fa3', '#7fd6e8', '#c9d36a'];

function addressText(o: ShipOrder): string {
  const d = o.address;
  if (!d) return '';
  const place = d.point_name ? [d.point_name, d.point_address, d.point_id ? `ID ${d.point_id}` : null] : [d.street, [d.zip, d.city].filter(Boolean).join(' '), d.country === 'SK' ? 'Slovensko' : null];
  return [d.recipient, ...place, d.phone].filter(Boolean).join('\n');
}

/** K odeslání podle prototypu: objednávky k zabalení a odeslání, vychystání podle míst, dodací listy a adresní štítky. */
export function ShipManager({ orders, toConfirm, q = '' }: { orders: ShipOrder[]; toConfirm: number; q?: string }) {
  const qs = q ? `&${q}` : '';
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const ready = orders.filter((o) => o.ready);
  const wait = orders.length - ready.length;
  const readyPcs = ready.reduce((s, o) => s + pcs(o), 0);
  const carriers = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) m.set(o.carrierName, (m.get(o.carrierName) ?? 0) + 1);
    return [...m];
  }, [orders]);
  const toPost = ready.filter((o) => o.delivery === 'ship' && o.address && !o.address.point_name);

  if (picking) return <PickView orders={ready} wait={wait} onBack={() => setPicking(false)} />;

  return (
    <>
      <div className="ohead">
        <div>
          <b>K odeslání: {plural(orders.length, ['objednávka', 'objednávky', 'objednávek'])}</b>
          <span className="ochs">{carriers.map(([c, n]) => <span key={c} className="src">{c} {n}</span>)}</span>
        </div>
        <div className="acts">
          {ready.length ? <a className="btn" href={`/prodat/tisk?druh=dodaci&o=${ready.map((o) => o.number).join(',')}${qs}`} target="_blank" rel="noopener">Dodací listy</a> : null}
          {toPost.length ? <a className="btn" href={`/prodat/tisk?druh=adresy&o=${toPost.map((o) => o.number).join(',')}${qs}`} target="_blank" rel="noopener">Adresní štítky</a> : null}
          <button type="button" className="btn p" disabled={!ready.length} onClick={() => setPicking(true)}>Vychystat {karet(readyPcs)}</button>
        </div>
      </div>
      {toConfirm ? (
        <div className="attn"><i className="adot" /><span><b>{plural(toConfirm, ['nová objednávka čeká', 'nové objednávky čekají', 'nových objednávek čeká'])}</b> na potvrzení. Po potvrzení se objeví tady.</span>
          <Link className="btn sm" href="/objednavky?tab=prodeje&stav=ja">Potvrdit</Link></div>
      ) : null}
      <div className="olist">
        <div className="orow oth"><span>Objednávka</span><span>Karty</span><span>Doprava</span><span>Platba</span><span>Štítek</span></div>
        {orders.length ? orders.map((o) => (
          <Fragment key={o.id}>
            <div className={`orow ocl${open === o.id ? ' open' : ''}`} onClick={() => setOpen(open === o.id ? null : o.id)}>
              <span className="on1"><b className="mono"><span className="chev" />č. {o.number}</b><small><span className="src">V4cards</span> {o.buyer}</small></span>
              <span className="oit">
                <span className="oim">{o.items.slice(0, 3).map((i) => (i.image ? <img key={i.key} src={thumbUrl(i.image)} alt="" /> : <img key={i.key} alt="" />))}</span>
                <span><b>{karet(pcs(o))}</b><small>{o.items.map((i) => i.name + (i.qty > 1 ? ` ×${i.qty}` : '')).join(', ')}</small></span>
              </span>
              <span className="osh"><b>{o.carrierName}</b><small>{o.address?.point_name ?? [o.address?.street, o.address?.city].filter(Boolean).join(', ')}</small></span>
              <span><Pay o={o} /></span>
              <span onClick={(e) => e.stopPropagation()}><Send o={o} crew={!!q} /></span>
            </div>
            {open === o.id ? <Detail o={o} q={q} /> : null}
          </Fragment>
        )) : <div className="none">Nic k odeslání. Potvrzené objednávky se tu objeví samy.</div>}
      </div>
      <p className="onote">Objednávky přes V4cards se sem načítají samy. Zásilky podáváte ve <b>svém vlastním</b> účtu dopravce jako dosud, číslo zásilky zadáte tady a kupující ho uvidí jako odkaz na sledování.</p>
    </>
  );
}

function Pay({ o }: { o: ShipOrder }) {
  if (o.payment === 'cod') return <span className="opay cod">Dobírka {formatPrice(o.total)}</span>;
  if (o.payment === 'cash') return <span className="opay cod">Hotově {formatPrice(o.total)}</span>;
  if (o.status === 'paid') return <span className="opay ok">Zaplaceno</span>;
  return <span className="opay wt">{o.buyerPaidAt ? 'Ověřte platbu' : 'Čeká na platbu'}</span>;
}

/** Odeslání: číslo zásilky + Odesláno (zásilka), Předáno (hotově při předání), jinak co se čeká. */
function Send({ o, crew }: { o: ShipOrder; crew?: boolean }) {
  if (!o.ready) {
    return o.buyerPaidAt && !crew ? <Link className="btn sm" href={`/objednavky/${o.number}`}>Potvrdit platbu</Link> : <span className="omut">čeká na zaplacení</span>;
  }
  if (o.delivery === 'pickup') {
    return o.payment === 'cash' ? (
      <form action={setOrderStatus}>
        <input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value="delivered" />
        <button type="submit" className="btn sm">Předáno</button>
      </form>
    ) : <span className="omut">bez štítku</span>;
  }
  return (
    <form action={setOrderStatus} style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
      <input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value="shipped" />
      <span className="inp" style={{ height: 32, width: 130, padding: '0 8px' }}><input name="tracking" maxLength={60} placeholder="Číslo zásilky" style={{ font: '500 12.5px var(--fm)' }} aria-label={`Číslo zásilky objednávky ${o.number}`} /></span>
      <button type="submit" className="btn sm">Odesláno</button>
    </form>
  );
}

function Detail({ o, q = '' }: { o: ShipOrder; q?: string }) {
  const sum = o.items.reduce((s, i) => s + i.price * i.qty, 0);
  const addr = addressText(o);
  return (
    <div className="odet">
      <div className="odl">
        {o.items.map((i) => (
          <div key={i.key} className="odr">
            <span className="pn"><b>{i.name}</b><small className="mono">{i.set} · {i.condition}{i.language ? ` · ${lang(i.language)}` : ''}</small></span>
            <span className="mono ploc">{i.location ?? '—'}</span>
            <span className="mono">{i.qty} × {formatPrice(i.price)}</span>
            <b className="mono odt">{formatPrice(i.price * i.qty)}</b>
          </div>
        ))}
      </div>
      <div className="ods">
        <div className="odsum">
          <div><span>Karty</span><b className="mono">{formatPrice(sum)}</b></div>
          <div><span>Doprava ({o.carrierName})</span><b className="mono">{o.shipping ? formatPrice(o.shipping) : 'zdarma'}</b></div>
          {o.codFee ? <div><span>Dobírka</span><b className="mono">{formatPrice(o.codFee)}</b></div> : null}
          <div className="odtot"><span>Celkem</span><b className="mono">{formatPrice(o.total)}</b></div>
        </div>
        <div className="odi">
          <div><span>Kupující</span><b>{o.buyer}</b></div>
          <div><span>Doručení</span><b style={{ whiteSpace: 'pre-line' }}>{addr || (o.delivery === 'pickup' ? 'Osobní předání, domluvte ve zprávách' : o.carrierName)}</b></div>
          <div><span>Objednáno</span><b>{formatDateTime(o.createdAt)}</b></div>
        </div>
        <div className="oda">
          {q ? null : <Link className="btn sm" href={`/objednavky/${o.number}`}>Otevřít objednávku</Link>}
          {addr ? <CopyButton text={addr} className="btn sm" /> : null}
          <a className="btn sm" href={`/prodat/tisk?druh=dodaci&o=${o.number}${q ? `&${q}` : ''}`} target="_blank" rel="noopener">Dodací list</a>
        </div>
      </div>
    </div>
  );
}

/** Vychystání: jedna tabulka podle umístění, číslo v kroužku = přihrádka (objednávka), odškrtnuté si pamatuje prohlížeč. */
function PickView({ orders, wait, onBack }: { orders: ShipOrder[]; wait: number; onBack: () => void }) {
  const storeKey = 'v4-pick:' + orders.map((o) => o.number).join(',');
  const [done, setDone] = useState<Set<string>>(new Set());
  const [text, setText] = useState(false);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(storeKey);
      if (v) setDone(new Set(JSON.parse(v) as string[]));
      setText(window.localStorage.getItem('v4-pick-text') === '1');
    } catch { /* prohlížeč bez úložiště */ }
  }, [storeKey]);
  function toggle(k: string) {
    setDone((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k); else n.add(k);
      try { window.localStorage.setItem(storeKey, JSON.stringify([...n])); } catch { /* bez úložiště */ }
      return n;
    });
  }
  function view(t: boolean) {
    setText(t);
    try { window.localStorage.setItem('v4-pick-text', t ? '1' : '0'); } catch { /* bez úložiště */ }
  }

  const rows = orders.flatMap((o, b) => o.items.map((i) => ({ ...i, bin: b + 1, order: o })));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const l = r.location?.split(' · ')[0] ?? NO_LOC;
    groups.set(l, [...(groups.get(l) ?? []), r]);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === NO_LOC ? 1 : b === NO_LOC ? -1 : a.localeCompare(b, 'cs', { numeric: true })));
  const sq = (list: typeof rows) => list.reduce((s, r) => s + r.qty, 0);
  const total = sq(rows);
  const picked = sq(rows.filter((r) => done.has(r.key)));
  const bin = (n: number, big?: boolean) => <span className={`vbn${big ? ' big' : ''}`} style={{ ['--c' as string]: BIN[(n - 1) % BIN.length] }}>{n}</span>;

  return (
    <>
      <div className="ohead">
        <div><button type="button" className="btn sm g" style={{ paddingLeft: 0 }} onClick={onBack}>← Zpět na objednávky</button><b>Vychystání · {plural(orders.length, ['objednávka', 'objednávky', 'objednávek'])}</b></div>
        <div className="acts">
          <span className="view" style={{ display: 'inline-flex' }}>
            <button type="button" className={text ? '' : 'on'} onClick={() => view(false)} title="Řádky s obrázky">{Ico.list}</button>
            <button type="button" className={text ? 'on' : ''} onClick={() => view(true)} title="Jen řádky">{Ico.text}</button>
          </span>
          <button type="button" className="btn" onClick={() => window.print()}>Vytisknout</button>
          <button type="button" className="btn p" onClick={onBack}>{picked === total ? 'Hotovo, jde se balit' : 'Hotovo'}</button>
        </div>
      </div>
      <div className="pprog"><span className="iprog"><i style={{ width: `${total ? (picked / total) * 100 : 0}%` }} /></span><span className="mono">{picked} / {total} karet</span></div>
      <div className="pwrap">
        <div className={`tbl${text ? ' pktx' : ''}`} style={{ margin: 0 }}>
          <div className="prow2 oth"><span />{text ? <><span /><span>Karta</span></> : <span style={{ gridColumn: '2/4' }}>Karta</span>}<span className="pslot">Umístění</span><span className="pq2">Kusů</span><span>Do přihrádky</span></div>
          {keys.map((l) => {
            const list = groups.get(l)!;
            const d = sq(list.filter((r) => done.has(r.key)));
            const t = sq(list);
            return (
              <Fragment key={l}>
                <div className={`pgh2${d === t ? ' ok' : ''}`}><b>{l}</b><span className="mono">{d === t ? 'hotovo' : `${d} / ${t} ks`}</span></div>
                {list.map((r) => (
                  <div key={r.key} className={`prow2${done.has(r.key) ? ' done' : ''}`} onClick={() => toggle(r.key)}>
                    <span className={`cb${done.has(r.key) ? ' on' : ''}`} />
                    {text ? null : r.image ? <img src={thumbUrl(r.image)} alt="" /> : <img alt="" />}
                    <span className="pn"><b>{r.name}</b><small className="mono">{r.set} · {r.condition}{r.language ? ` · ${lang(r.language)}` : ''}</small></span>
                    <span className="pslot mono">{r.location ?? '—'}</span>
                    <span className="pq2 mono">{r.qty}×</span>
                    <span className="pbin2">{bin(r.bin, true)}<small className="mono">č. {r.order.number}</small></span>
                  </div>
                ))}
              </Fragment>
            );
          })}
        </div>
        <aside className="vbs">
          <b>Přihrádky</b>
          <small>Každá přihrádka (hromádka) je jedna objednávka.</small>
          {orders.map((o, b) => {
            const list = rows.filter((r) => r.bin === b + 1);
            const d = sq(list.filter((r) => done.has(r.key)));
            const t = sq(list);
            return (
              <div key={o.id} className={`vbr${d === t ? ' ok' : ''}`}>
                {bin(b + 1)}
                <span><b className="mono">č. {o.number}</b><small>{o.buyer} · {o.carrierName}</small></span>
                <em className="mono">{d === t ? 'hotovo' : `${d} / ${t}`}</em>
              </div>
            );
          })}
          {wait ? <small className="vbw">{plural(wait, ['objednávka čeká', 'objednávky čekají', 'objednávek čeká'])} na zaplacení, sem se nezahrnují.</small> : null}
        </aside>
      </div>
    </>
  );
}
