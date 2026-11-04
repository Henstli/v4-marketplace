'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { fold } from '@/lib/import/columns';
import { stockBulkSet } from './sk-actions';
import type { DemandCard, MarketView, PriceRow } from './market';
import type { Perm } from './team';
import { demandSell } from './team-actions';
import { Ico, kc, nf } from './sk';

function href(q: string, params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams({ zalozka: 'trh' });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  if (q) sp.set('obchod', q.slice('obchod='.length));
  return `/prodat?${sp.toString()}`;
}

const ppl = (n: number) => `${nf(n)} ${n >= 5 ? 'lidí' : n >= 2 ? 'lidé' : 'člověk'}`;
const gname = (g: string | null) => (g ? (getGame(g)?.name ?? g).replace('Magic: The Gathering', 'Magic') : '');

function CardCell({ d }: { d: { slug?: string | null; name: string; set: string; image: string | null; game?: string | null } }) {
  const img = d.image ? thumbUrl(d.image) : undefined;
  return (
    <span className="cn">
      {img ? <img className="dim2" src={img} alt="" /> : <img className="dim2" alt="" />}
      <span>{d.slug ? <Link href={`/karty/${d.slug}`}><b>{d.name}</b></Link> : <b>{d.name}</b>}<small className="mono">{d.set}{d.game ? ` · ${gname(d.game)}` : ''}</small></span>
    </span>
  );
}

/** Záložka Trh podle prototypu: Poptávka u vás, Celý trh, Vaše ceny. */
export function MarketViews({ view, q, perms, owner, days, demand, market, prices, have }: {
  view: MarketView; q: string; perms: Perm[]; owner: string; days: number;
  demand?: DemandCard[]; market?: { top: DemandCard[]; games: { game_id: string; wanters: number; recent: number }[] };
  prices?: PriceRow[]; have?: Record<string, number>;
}) {
  const can = (p: Perm) => perms.includes(p);
  const v = view === 'automaticke' ? 'poptavka' : view;
  return (
    <>
      <div className="dsw">
        <div className="seg">
          {([['poptavka', 'Poptávka u vás'], ['trh', 'Celý trh'], ['ceny', 'Vaše ceny']] as const).map(([k, l]) => (
            <Link key={k} className={v === k ? 'on' : ''} href={href(q, { pohled: k === 'poptavka' ? undefined : k })}>{l}</Link>
          ))}
        </div>
        {v === 'trh' ? (
          <div className="dsw2">
            <div className="seg sm2">
              {[7, 30].map((d) => <Link key={d} className={days === d ? 'on' : ''} href={href(q, { pohled: 'trh', dni: d === 7 ? undefined : d })}>{d} dní</Link>)}
            </div>
          </div>
        ) : null}
      </div>
      {v === 'poptavka' && demand ? <Demand list={demand} owner={owner} canSell={can('price')} /> : null}
      {v === 'trh' && market ? <Market data={market} days={days} have={have ?? {}} /> : null}
      {v === 'ceny' && prices ? <Prices rows={prices} canEdit={can('price')} /> : null}
    </>
  );
}

// ===== Poptávka u vás =====

function Demand({ list, owner, canSell }: { list: DemandCard[]; owner: string; canSell: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const router = useRouter();
  const H = list.filter((d) => d.keep > 0 || d.onSale > 0);
  const N = list.filter((d) => d.keep === 0 && d.onSale === 0 && d.market != null).slice(0, 50);
  const sell = (d: DemandCard) => start(async () => {
    const r = await demandSell(owner, d.cardId);
    setMsg(r.error ? { ok: false, t: r.error } : { ok: true, t: r.text ?? 'Karta je na prodej.' });
    if (!r.error) router.refresh();
  });
  if (!list.length) return <div className="tbl"><div className="none">Zatím nikdo nic nehledá. Jakmile si sběratelé začnou karty hlídat, uvidíte tady, co chtějí.</div></div>;
  const buy = (d: DemandCard) => Math.round((d.market ?? 0) * 0.6);
  return (
    <>
      {msg ? <div className={`toast${msg.ok ? '' : ' err'}`} role="status">{msg.t}</div> : null}
      {H.length ? (
        <div className="dsec">
          <div className="dsh"><div><b>Prodejte hned</b><small>Karty máte ve skladu. Po kliknutí je dáme na prodej a hledajícím pošleme upozornění.</small></div></div>
          <div className="olist dlist">
            <div className="drw d1 oth"><span>Karta</span><span>Chce koupit</span><span>Ve skladu</span><span>Prodáte až za</span><span /></div>
            {H.map((d) => {
              const n = Math.min(d.keep + d.onSale, d.wanters);
              return (
                <div key={d.cardId} className="drw d1">
                  <CardCell d={d} />
                  <span><b className="dn2">{ppl(d.wanters)}</b>{d.recent ? <small className="dtr">+{d.recent} za týden</small> : null}</span>
                  <span className="mono">{d.keep + d.onSale} ks</span>
                  <span>{d.market != null ? <><b className="mono acc">{kc(n * d.market)}</b><small>{n} × {kc(d.market)}</small></> : <span className="mono">—</span>}</span>
                  <span className="dact">{d.keep > 0 && canSell
                    ? <button type="button" className="btn sm p" disabled={pending} onClick={() => sell(d)}>Dát na prodej</button>
                    : d.keep > 0 ? null : <span className="dhon">{Ico.sale} Na prodej</span>}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {N.length ? (
        <div className="dsec">
          <div className="dsh"><div><b>Vykupte a prodejte</b><small>Karty, které lidé hledají a vy je nemáte. Když je vykoupíte za 60 % trhu, takhle na nich vyděláte.</small></div></div>
          <div className="olist dlist">
            <div className="drw d2 oth"><span>Karta</span><span>Chce koupit</span><span>Vykoupíte za</span><span>Prodáte za</span><span>Váš zisk</span><span /></div>
            {N.map((d) => (
              <div key={d.cardId} className="drw d2">
                <CardCell d={d} />
                <span><b className="dn2">{ppl(d.wanters)}</b>{d.recent ? <small className="dtr">+{d.recent} za týden</small> : null}</span>
                <span className="bpc"><span className="mono">{kc(buy(d))}</span><small className="bpm">60 % trhu</small></span>
                <span className="mono">{kc(d.market)}</span>
                <b className="mono acc">+{kc((d.market ?? 0) - buy(d))}</b>
                <span className="dact">{d.slug ? <Link className="btn sm g" href={`/karty/${d.slug}`}>Karta</Link> : null}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <p className="onote">Jen souhrnná čísla: kolik lidí kartu hlídá. Kdo konkrétně, neukazujeme.</p>
    </>
  );
}

// ===== Celý trh =====

function MkList({ title, sub, rows, render }: { title: string; sub: string; rows: DemandCard[]; render: (d: DemandCard, i: number) => React.ReactNode }) {
  const [mq, setMq] = useState('');
  const L = useMemo(() => {
    const t = fold(mq.trim());
    return rows.map((d, i) => [d, i] as const).filter(([d]) => !t || fold(`${d.name} ${d.set}`).includes(t));
  }, [rows, mq]);
  return (
    <div className="mkc">
      <div className="mkh mkhs">
        <div><b>{title}</b><small>{sub}</small></div>
        <label className="inp mkq2">{Ico.s}<input value={mq} placeholder="Hledat kartu" onChange={(e) => setMq(e.target.value)} /></label>
      </div>
      <div className="mkl">{L.length ? L.map(([d, i]) => render(d, i)) : <div className="mkq"><span style={{ color: 'var(--ink-muted)' }}>Nic tu není.</span></div>}</div>
    </div>
  );
}

function Market({ data, days, have }: { data: { top: DemandCard[]; games: { game_id: string; wanters: number; recent: number }[] }; days: number; have: Record<string, number> }) {
  const top = data.top;
  const mxT = Math.max(1, ...top.map((d) => d.wanters));
  const mxG = Math.max(1, ...data.games.map((g) => g.wanters));
  const rise = [...top].filter((d) => d.recent > 0).sort((a, b) => b.recent / Math.max(1, b.wanters - b.recent) - a.recent / Math.max(1, a.wanters - a.recent));
  const short = [...top].filter((d) => d.wanters >= 2 && (d.offers ?? 0) <= Math.max(1, d.wanters / 2)).sort((a, b) => b.wanters / Math.max(1, b.offers ?? 0) - a.wanters / Math.max(1, a.offers ?? 0));
  const people = data.games.reduce((a, g) => a + g.wanters, 0);
  const recent = data.games.reduce((a, g) => a + g.recent, 0);
  const none = top.filter((d) => !(d.offers ?? 0)).length;
  const fast = [...data.games].sort((a, b) => b.recent - a.recent)[0];
  const img = (d: DemandCard) => (d.image ? <img src={thumbUrl(d.image)} alt="" /> : <img alt="" />);
  const own = (d: DemandCard) => <span className={`mkh2${have[d.cardId] ? '' : ' no'}`}>{have[d.cardId] ? `máte ${nf(have[d.cardId])} ks` : 'nemáte'}</span>;
  const link = (d: DemandCard, cls: string, body: React.ReactNode) => (
    <Link key={d.cardId} className={`mkr ${cls} cl`} href={`/karty/${d.slug}`} title={`${d.name}: hledá ${ppl(d.wanters)}`}>{body}</Link>
  );
  return (
    <>
      <div className="mkk">
        <div><small>Hledajících lidí</small><b className="mono">{nf(people)}</b><span>hlídá nebo hledá kartu{recent ? `, +${nf(recent)} za ${days} dní` : ''}</span></div>
        <div><small>Hledaných karet</small><b className="mono">{nf(top.length)}</b><span>nejhledanějších karet a variant</span></div>
        <div><small>Hledání bez nabídky</small><b className="mono">{nf(none)}</b><span>karty, které nikdo neprodává</span></div>
        <div><small>Nejrychlejší růst</small><b>{fast && fast.recent ? gname(fast.game_id) : '—'}</b><span>{fast && fast.recent ? `+${nf(fast.recent)} za ${days} dní` : 'zatím beze změny'}</span></div>
      </div>
      <div className="mkg">
        <MkList title="Nejhledanější karty" sub="kolik lidí kartu hlídá nebo hledá" rows={top} render={(d, i) => link(d, '', <>
          <span className="mkn mono">{i + 1}</span>{img(d)}
          <span className="mkt"><b>{d.name}</b><small className="mono">{d.set}{d.game ? ` · ${gname(d.game)}` : ''}</small></span>
          <span className="mkb"><i style={{ width: `${(d.wanters / mxT) * 100}%` }} /></span><b className="mono mkv">{d.wanters}</b>{own(d)}
        </>)} />
        <MkList title="Rostoucí zájem" sub={`noví hledající za posledních ${days} dní`} rows={rise} render={(d) => link(d, 'mkr2', <>
          {img(d)}<span className="mkt"><b>{d.name}</b><small className="mono">{d.set}</small></span>
          <span className="mks"><b className="mono">+{d.recent}</b> nově<br />celkem <b className="mono">{d.wanters}</b></span>
          <b className="mono acc">+{Math.round((d.recent / Math.max(1, d.wanters - d.recent)) * 100)} %</b>
        </>)} />
        <MkList title="Nedostatkové karty" sub="hodně zájemců, málo nabídek, nejlepší ke vykoupení" rows={short} render={(d) => link(d, 'mkr3', <>
          {img(d)}<span className="mkt"><b>{d.name}</b><small className="mono">{d.set}</small></span>
          <span className="mks"><b className="mono">{d.wanters}</b> zájemců<br /><b className="mono">{d.offers ?? 0}</b> {(d.offers ?? 0) === 1 ? 'nabídka' : (d.offers ?? 0) > 1 && (d.offers ?? 0) < 5 ? 'nabídky' : 'nabídek'}</span>
          <span className="mkr4">{d.offers ? <><em>{Math.round(d.wanters / d.offers)}×</em><small>víc zájmu</small></> : <><em>0</em><small>nabídek</small></>}</span>{own(d)}
        </>)} />
        <div className="mkc">
          <div className="mkh"><b>Poptávka podle her</b><small>lidí, kteří kartu z hry hledají nebo hlídají</small></div>
          {data.games.length ? data.games.map((g) => (
            <div key={g.game_id} className="mkgr" title={`${gname(g.game_id)}: ${g.wanters} hledajících, +${g.recent}`}>
              <span>{gname(g.game_id)}</span><span className="mkb"><i style={{ width: `${(g.wanters / mxG) * 100}%` }} /></span>
              <b className="mono">{nf(g.wanters)}</b><span className={`mono ${g.recent ? 'acc' : 'mkdn'}`}>+{g.recent}</span>
            </div>
          )) : <div className="mkq"><span style={{ color: 'var(--ink-muted)' }}>Zatím nikdo nic nehledá.</span></div>}
        </div>
      </div>
      <p className="onote">Jen souhrnná čísla, nikdy kdo konkrétně. Aktualizujeme průběžně.</p>
    </>
  );
}

// ===== Vaše ceny =====

type PF = 'hi' | 'lo' | 'old';

function Prices({ rows, canEdit }: { rows: PriceRow[]; canEdit: boolean }) {
  const [f, setF] = useState<PF>('hi');
  const [text, setText] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const router = useRouter();
  const diff = (r: PriceRow) => (r.market ? r.price / r.market - 1 : 0);
  const P = useMemo(() => ({
    hi: rows.filter((r) => r.market != null && diff(r) > 0.05),
    lo: rows.filter((r) => r.market != null && diff(r) < -0.05),
    ok: rows.filter((r) => r.market != null && Math.abs(diff(r)) <= 0.05),
    old: rows.filter((r) => (r.days ?? 0) > 60),
  }), [rows]);
  const L = [...P[f]].sort((a, b) => (f === 'old' ? (b.days ?? 0) - (a.days ?? 0) : Math.abs(diff(b)) - Math.abs(diff(a))));
  const fixable = L.filter((r) => r.recommended != null && r.recommended !== r.price);
  const lost = P.lo.reduce((a, r) => a + ((r.market ?? r.price) - r.price) * r.quantity, 0);
  const apply = (list: PriceRow[]) => start(async () => {
    const r = await stockBulkSet(list.map((x) => ({ id: x.id, price_czk: x.recommended! })), list.length === 1 ? `Cena podle trhu: ${list[0].name}` : `Doporučené ceny: ${list.length} karet`, 'price');
    setMsg(r.error ? { ok: false, t: r.error } : { ok: true, t: list.length === 1 ? `${list[0].name}: cena ${kc(list[0].recommended)}.` : `Nové ceny u ${nf(r.count ?? 0)} karet. Jde to vrátit v Historii.` });
    if (!r.error) router.refresh();
  });
  const why = (r: PriceRow) => ((r.days ?? 0) > 60 ? 'trh −5 %, leží dlouho' : r.low != null && r.recommended === r.low ? 'nejlevnější nabídka' : 'trh −3 %');
  if (!rows.length) return <div className="tbl"><div className="none">Nic na prodej. Až dáte karty na prodej s cenou, porovnáme je tady s trhem.</div></div>;
  return (
    <>
      {msg ? <div className={`toast${msg.ok ? '' : ' err'}`} role="status">{msg.t}</div> : null}
      <p className="ilead" style={{ marginBottom: 14 }}>Jak si stojí karty, které máte na prodej, proti tržní ceně na V4cards.</p>
      <div className="mkc" style={{ marginBottom: 12 }}>
        <div className="pvbar">
          {P.lo.length ? <i className="pvlo" style={{ flex: P.lo.length }} title={`Levnější než trh: ${P.lo.length}`} /> : null}
          {P.ok.length ? <i className="pvok" style={{ flex: P.ok.length }} title={`V trhu: ${P.ok.length}`} /> : null}
          {P.hi.length ? <i className="pvhi" style={{ flex: P.hi.length }} title={`Dražší než trh: ${P.hi.length}`} /> : null}
        </div>
        <div className="pvleg" style={{ marginBottom: 0 }}>
          <span><i className="pvlo" />Levnější o víc než 5 % <b className="mono">{P.lo.length}</b></span>
          <span><i className="pvok" />V trhu (±5 %) <b className="mono">{P.ok.length}</b></span>
          <span><i className="pvhi" />Dražší o víc než 5 % <b className="mono">{P.hi.length}</b></span>
        </div>
      </div>
      <div className="pvk">
        <div><small>Karet na prodej</small><b className="mono">{nf(rows.length)}</b></div>
        <div><small>Leží přes 60 dní</small><b className="mono">{nf(P.old.length)}</b></div>
        <div><small>Pod trhem přicházíte o</small><b className="mono">{kc(lost)}</b></div>
      </div>
      <div className="pvtop">
        <div className="seg pvs">
          {([['hi', `Dražší než trh (${P.hi.length})`], ['lo', `Levnější než trh (${P.lo.length})`], ['old', `Leží přes 60 dní (${P.old.length})`]] as [PF, string][]).map(([k, t]) => (
            <button key={k} type="button" className={f === k ? 'on' : ''} onClick={() => setF(k)}>{t}</button>
          ))}
        </div>
        <div className="pvra">
          {canEdit && fixable.length ? <button type="button" className="btn p" disabled={pending} onClick={() => apply(fixable)}>Použít doporučené všem ({fixable.length})</button> : null}
          <span className="view">
            <button type="button" className={!text ? 'on' : ''} title="Řádky s obrázky" onClick={() => setText(false)}>{Ico.list}</button>
            <button type="button" className={text ? 'on' : ''} title="Jen řádky" onClick={() => setText(true)}>{Ico.text}</button>
          </span>
        </div>
      </div>
      {f === 'old' && L.length ? <p className="pvold">V těchto kartách leží <b className="mono">{kc(L.reduce((a, r) => a + r.price * r.quantity, 0))}</b>.</p> : null}
      <div className={`olist${text ? ' pvtxt' : ''}`}>
        <div className="pvr oth"><span>Karta</span><span>Vaše cena</span><span>Trh</span><span>Nejlevnější</span><span>Rozdíl</span><span>{f === 'old' ? 'Leží' : 'Na prodej'}</span><span>Doporučená</span><span /></div>
        {L.length ? L.slice(0, 300).map((r) => {
          const d = diff(r);
          return (
            <div key={r.id} className="pvr">
              <span className="cn">
                {r.image ? <img className="dim2" src={thumbUrl(r.image)} alt="" /> : <img className="dim2" alt="" />}
                <span><b>{r.name}</b><small className="mono">{r.set} · {r.condition}</small></span>
              </span>
              <span className="mono">{kc(r.price)}</span>
              <span className="mono">{kc(r.market)}</span>
              <span className="mono">{kc(r.low)}</span>
              <b className={`mono ${d > 0.05 ? 'neg' : d < -0.05 ? 'mut' : ''}`}>{r.market == null ? '—' : `${d >= 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)} %`}</b>
              <span className="mono">{f === 'old' ? `${r.days} dní` : `${r.quantity} ks`}</span>
              <span className="pvrec">{r.recommended != null ? <><b className="mono acc">{kc(r.recommended)}</b><small>{why(r)}</small></> : <span className="mono">—</span>}</span>
              <span className="dact">{canEdit && r.recommended != null && r.recommended !== r.price ? <button type="button" className="btn sm" disabled={pending} onClick={() => apply([r])}>Použít</button> : null}</span>
            </div>
          );
        }) : <div className="pvr"><span style={{ color: 'var(--ink-muted)' }}>Žádné karty.</span></div>}
      </div>
    </>
  );
}
