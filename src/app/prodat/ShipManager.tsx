'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, CardThumb } from '@/components/trezor';
import { CopyButton } from '@/components/orders/CopyButton';
import { formatDateTime, formatPrice, plural } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';
import { setOrderStatus } from '../objednavky/actions';
import type { ShipOrder } from './ship';

const karet = (n: number) => plural(n, ['karta', 'karty', 'karet']);
const pcs = (o: ShipOrder) => o.items.reduce((s, i) => s + i.qty, 0);
const lang = (l: string | null) => (l ? LANGUAGE_NAMES[l as Language] ?? l : '');
const NO_LOC = 'Bez umístění';
/** Barvy přihrádek (jedna přihrádka = jedna objednávka); číslo v kroužku je vždy vidět, barva jen pomáhá. */
const BIN = ['#5fd0a8', '#6aa9ff', '#f0b35a', '#b58cff', '#ff8fa3', '#7fd6e8', '#c9d36a'];

function Bin({ n, big }: { n: number; big?: boolean }) {
  return <span className={`tz-stk-bin${big ? ' is-big' : ''}`} style={{ ['--c' as string]: BIN[(n - 1) % BIN.length] }}>{n}</span>;
}

function addressText(o: ShipOrder): string {
  const d = o.address;
  if (!d) return '';
  const place = d.point_name ? [d.point_name, d.point_address, d.point_id ? `ID ${d.point_id}` : null] : [d.street, [d.zip, d.city].filter(Boolean).join(' '), d.country === 'SK' ? 'Slovensko' : null];
  return [d.recipient, ...place, d.phone].filter(Boolean).join('\n');
}

/** K odeslání: objednávky k zabalení a odeslání, vychystání podle míst, dodací listy a adresní štítky. */
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="tz-stk-shiphead">
        <div>
          <b>K odeslání: {plural(orders.length, ['objednávka', 'objednávky', 'objednávek'])}</b>
          <span className="tz-stk-pills">{carriers.map(([c, n]) => <span key={c} className="tz-stk-src">{c} {n}</span>)}</span>
        </div>
        <div className="tz-stk-hacts">
          {ready.length ? <a className="tz-btn tz-btn-ghost tz-btn-md" href={`/prodat/tisk?druh=dodaci&o=${ready.map((o) => o.number).join(',')}${qs}`} target="_blank" rel="noopener">Dodací listy ({ready.length})</a> : null}
          {toPost.length ? <a className="tz-btn tz-btn-ghost tz-btn-md" href={`/prodat/tisk?druh=adresy&o=${toPost.map((o) => o.number).join(',')}${qs}`} target="_blank" rel="noopener">Adresní štítky ({toPost.length})</a> : null}
          <Button disabled={!ready.length} onClick={() => setPicking(true)}>Vychystat {karet(readyPcs)}</Button>
        </div>
      </div>
      {toConfirm ? <p className="tz-stk-msg is-ok"><Link href="/objednavky?tab=prodeje&stav=ja">{plural(toConfirm, ['nová objednávka čeká', 'nové objednávky čekají', 'nových objednávek čeká'])} na potvrzení</Link>. Po potvrzení se objeví tady.</p> : null}

      {orders.length ? (
        <div className="tz-stk-olist">
          <div className="tz-stk-orow is-head"><span>Objednávka</span><span>Karty</span><span>Doprava</span><span>Platba</span><span>Odeslání</span></div>
          {orders.map((o) => (
            <Fragment key={o.id}>
              <div className={`tz-stk-orow${open === o.id ? ' is-open' : ''}`} onClick={() => setOpen(open === o.id ? null : o.id)}>
                <span><b className="tz-stk-code">č. {o.number}</b><small>{o.buyer} · {formatDateTime(o.createdAt)}</small></span>
                <span className="tz-stk-oit">
                  <span className="tz-stk-oim">{o.items.slice(0, 3).map((i) => <CardThumb key={i.key} size="sm" image={thumbUrl(i.image ?? undefined)} color={i.game ? `var(--game-${i.game}-art, var(--surface-sunken))` : undefined} />)}</span>
                  <span><b>{karet(pcs(o))}</b><small>{o.items.map((i) => i.name + (i.qty > 1 ? ` ×${i.qty}` : '')).join(', ')}</small></span>
                </span>
                <span><b>{o.carrierName}</b><small>{o.address?.point_name ?? o.address?.city ?? ''}</small></span>
                <span><Pay o={o} /></span>
                <span onClick={(e) => e.stopPropagation()}><Send o={o} crew={!!q} /></span>
              </div>
              {open === o.id ? <Detail o={o} q={q} /> : null}
            </Fragment>
          ))}
        </div>
      ) : (
        <div className="tz-stk-empty"><b>Nic k odeslání</b>Potvrzené objednávky se tu objeví samy.</div>
      )}
      <p className="t-small muted">Zásilky podáváte ve svém účtu dopravce jako dosud. Po podání sem zadejte číslo zásilky a kupující ho uvidí jako odkaz na sledování. Automatické podání a štítky dopravců přidáme s napojením dopravců.</p>
    </div>
  );
}

function Pay({ o }: { o: ShipOrder }) {
  if (o.payment === 'cod') return <span className="tz-stk-pay is-cod">Dobírka {formatPrice(o.total)}</span>;
  if (o.payment === 'cash') return <span className="tz-stk-pay is-cod">Hotově {formatPrice(o.total)}</span>;
  if (o.status === 'paid') return <span className="tz-stk-pay is-ok">Zaplaceno</span>;
  return <span className="tz-stk-pay is-wait">{o.buyerPaidAt ? 'Kupující zaplatil, ověřte platbu' : 'Čeká na platbu'}</span>;
}

/** Odeslání: číslo zásilky + Odesláno (zásilka), Předáno (hotově při předání), jinak co se čeká. */
function Send({ o, crew }: { o: ShipOrder; crew?: boolean }) {
  if (!o.ready) {
    return o.buyerPaidAt && !crew ? <Link className="tz-btn tz-btn-secondary tz-btn-sm" href={`/objednavky/${o.number}`}>Potvrdit platbu</Link> : <span className="tz-stk-muted t-small">čeká na zaplacení</span>;
  }
  if (o.delivery === 'pickup') {
    return o.payment === 'cash' ? (
      <form action={setOrderStatus} className="tz-stk-send">
        <input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value="delivered" />
        <Button size="sm" type="submit">Předáno</Button>
      </form>
    ) : <span className="tz-stk-muted t-small">Domluvte předání</span>;
  }
  return (
    <form action={setOrderStatus} className="tz-stk-send">
      <input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value="shipped" />
      <input name="tracking" maxLength={60} className="tz-cell-input tz-stk-code" placeholder="Číslo zásilky" aria-label={`Číslo zásilky objednávky ${o.number}`} />
      <Button size="sm" type="submit">Odesláno</Button>
    </form>
  );
}

function Detail({ o, q = '' }: { o: ShipOrder; q?: string }) {
  const sum = o.items.reduce((s, i) => s + i.price * i.qty, 0);
  const addr = addressText(o);
  return (
    <div className="tz-stk-odet">
      <div>
        {o.items.map((i) => (
          <div key={i.key} className="tz-stk-odr">
            <span><b>{i.name}</b><small className="tz-stk-code">{i.set} · {i.condition}{i.language ? ` · ${lang(i.language)}` : ''}</small></span>
            <span className="tz-stk-code tz-stk-muted">{i.location ?? '–'}</span>
            <span className="tz-stk-code">{i.qty} × {formatPrice(i.price)}</span>
            <b className="tz-stk-code">{formatPrice(i.price * i.qty)}</b>
          </div>
        ))}
      </div>
      <div className="tz-stk-odside">
        <dl className="tz-stk-facts">
          <dt>Karty</dt><dd>{formatPrice(sum)}</dd>
          <dt>{o.carrierName}</dt><dd>{o.shipping ? formatPrice(o.shipping) : 'zdarma'}</dd>
          {o.codFee ? <><dt>Dobírka</dt><dd>{formatPrice(o.codFee)}</dd></> : null}
          <dt><b>Celkem</b></dt><dd><b>{formatPrice(o.total)}</b></dd>
        </dl>
        {addr ? (
          <div className="tz-stk-addr">
            <small>Kam poslat</small>
            <pre>{addr}</pre>
            <CopyButton text={addr} className="tz-ord-copy" />
          </div>
        ) : o.delivery === 'pickup' ? <p className="t-small muted">Osobní předání, místo a čas domluvte ve zprávách.</p> : null}
        <div className="tz-stk-hacts">
          {q ? null : <Link className="tz-btn tz-btn-ghost tz-btn-sm" href={`/objednavky/${o.number}`}>Otevřít objednávku</Link>}
          <a className="tz-btn tz-btn-secondary tz-btn-sm" href={`/prodat/tisk?druh=dodaci&o=${o.number}${q ? `&${q}` : ''}`} target="_blank" rel="noopener">Dodací list</a>
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
    const l = r.location ?? NO_LOC;
    groups.set(l, [...(groups.get(l) ?? []), r]);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === NO_LOC ? 1 : b === NO_LOC ? -1 : a.localeCompare(b, 'cs', { numeric: true })));
  const sq = (list: typeof rows) => list.reduce((s, r) => s + r.qty, 0);
  const total = sq(rows);
  const picked = sq(rows.filter((r) => done.has(r.key)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="tz-stk-shiphead">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>← Zpět na objednávky</Button>
          <b>Vychystání · {plural(orders.length, ['objednávka', 'objednávky', 'objednávek'])} · {picked} / {total} ks</b>
        </div>
        <div className="tz-stk-hacts">
          <button type="button" className="tz-stk-fbtn" aria-pressed={!text} onClick={() => view(false)}>S obrázky</button>
          <button type="button" className="tz-stk-fbtn" aria-pressed={text} onClick={() => view(true)}>Jen text</button>
          <Button variant="secondary" onClick={() => window.print()}>Vytisknout</Button>
          <Button onClick={onBack}>{picked === total ? 'Hotovo, jde se balit' : 'Hotovo'}</Button>
        </div>
      </div>
      <div className="tz-stk-pick">
        <div className="tz-stk-picklist">
          {keys.map((l) => {
            const list = groups.get(l)!;
            const d = sq(list.filter((r) => done.has(r.key)));
            const t = sq(list);
            return (
              <Fragment key={l}>
                <div className={`tz-stk-pgh${d === t ? ' is-done' : ''}`}><b>{l}</b><span className="tz-stk-code">{d === t ? 'hotovo' : `${d} / ${t} ks`}</span></div>
                {list.map((r) => (
                  <label key={r.key} className={`tz-stk-prow${done.has(r.key) ? ' is-done' : ''}${text ? ' is-text' : ''}`}>
                    <input type="checkbox" checked={done.has(r.key)} onChange={() => toggle(r.key)} />
                    {text ? null : <CardThumb size="sm" image={thumbUrl(r.image ?? undefined)} color={r.game ? `var(--game-${r.game}-art, var(--surface-sunken))` : undefined} />}
                    <span><b>{r.name}</b><small className="tz-stk-code">{r.set} · {r.condition}{r.language ? ` · ${lang(r.language)}` : ''}</small></span>
                    <span className="tz-stk-code tz-stk-qn">{r.qty}×</span>
                    <span className="tz-stk-pbin"><Bin n={r.bin} big /><small className="tz-stk-code">č. {r.order.number}</small></span>
                  </label>
                ))}
              </Fragment>
            );
          })}
        </div>
        <aside className="tz-stk-bins">
          <b>Přihrádky</b>
          <small>Každá přihrádka (hromádka) je jedna objednávka.</small>
          {orders.map((o, b) => {
            const list = rows.filter((r) => r.bin === b + 1);
            const d = sq(list.filter((r) => done.has(r.key)));
            const t = sq(list);
            return (
              <div key={o.id} className={`tz-stk-binrow${d === t ? ' is-done' : ''}`}>
                <Bin n={b + 1} />
                <span><b className="tz-stk-code">č. {o.number}</b><small>{o.buyer} · {o.carrierName}</small></span>
                <em className="tz-stk-code">{d === t ? 'hotovo' : `${d} / ${t}`}</em>
              </div>
            );
          })}
          {wait ? <small>{plural(wait, ['objednávka čeká', 'objednávky čekají', 'objednávek čeká'])} na zaplacení, sem se nezahrnují.</small> : null}
        </aside>
      </div>
    </div>
  );
}
