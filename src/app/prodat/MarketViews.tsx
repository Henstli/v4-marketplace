'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, CardThumb } from '@/components/trezor';
import { formatDateTime, formatNumber, formatPrice, plural } from '@/lib/format';
import { GAMES, getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';
import { stockChange } from './actions';
import type { AutoChange, AutoRules, DemandCard, MarketView, PriceRow } from './market';
import type { Perm } from './team';
import { autopriceSave, demandSell, type Res } from './team-actions';

function href(q: string, params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams({ zalozka: 'trh' });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  if (q) sp.set('obchod', q.slice('obchod='.length));
  return `/prodat?${sp.toString()}`;
}

function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<Res>) => start(async () => {
    const r = await fn();
    setMsg(r.error ? { ok: false, text: r.error } : r.text ? { ok: true, text: r.text } : null);
  });
  const note = msg ? <p className={`tz-stk-msg ${msg.ok ? 'is-ok' : 'is-err'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null;
  return { pending, run, note };
}

const lidi = (n: number) => plural(n, ['člověk', 'lidé', 'lidí']);

function Card({ c }: { c: { slug?: string | null; name: string; set: string; image: string | null } }) {
  return (
    <span className="tz-stk-card">
      <CardThumb image={thumbUrl(c.image ?? undefined)} preview={c.image ?? undefined} />
      <span>{c.slug ? <Link href={`/karty/${c.slug}`}><b>{c.name}</b></Link> : <b>{c.name}</b>}<small className="tz-stk-code">{c.set}</small></span>
    </span>
  );
}

/** Záložka Trh (obchod): Poptávka u vás, Celý trh, Vaše ceny, Automatické ceny. */
export function MarketViews({ view, q, perms, owner, days, demand, market, prices, auto, places }: {
  view: MarketView; q: string; perms: Perm[]; owner: string; days: number;
  demand?: DemandCard[]; market?: { top: DemandCard[]; games: { game_id: string; wanters: number; recent: number }[] };
  prices?: PriceRow[]; auto?: { rules: AutoRules; changes: AutoChange[] }; places: string[];
}) {
  const can = (p: Perm) => perms.includes(p);
  const tabs: [MarketView, string, boolean][] = [
    ['poptavka', 'Poptávka u vás', true], ['trh', 'Celý trh', true], ['ceny', 'Vaše ceny', true],
    ['automaticke', 'Automatické ceny', can('price') || can('conn')],
  ];
  return (
    <>
      <div className="tz-stk-tools" role="navigation" aria-label="Trh">
        {tabs.filter((t) => t[2]).map(([k, l]) => (
          <Link key={k} className="tz-stk-fbtn" aria-pressed={view === k} href={href(q, { pohled: k === 'poptavka' ? undefined : k })}>{l}</Link>
        ))}
      </div>
      {view === 'poptavka' && demand ? <Demand list={demand} owner={owner} canSell={can('price')} /> : null}
      {view === 'trh' && market ? <Market data={market} q={q} days={days} /> : null}
      {view === 'ceny' && prices ? <Prices rows={prices} canEdit={can('price')} /> : null}
      {view === 'automaticke' && auto ? <Auto owner={owner} data={auto} places={places} canEdit={can('conn')} /> : null}
      <p className="t-small muted">Poptávka jsou jen souhrnná čísla: kolik lidí kartu hledá (Hledám) nebo hlídá (Dát vědět, až se objeví). Kdo konkrétně, neukazujeme.</p>
    </>
  );
}

// ===== Poptávka u vás =====

function Demand({ list, owner, canSell }: { list: DemandCard[]; owner: string; canSell: boolean }) {
  const { pending, run, note } = useRun();
  const have = list.filter((d) => d.keep > 0 || d.onSale > 0);
  const missing = list.filter((d) => d.keep === 0 && d.onSale === 0);
  if (!list.length) return <div className="tz-stk-empty"><b>Zatím nikdo nic nehledá</b>Jakmile si sběratelé přidají karty do Hledám nebo je začnou hlídat, uvidíte tady, co chtějí.</div>;
  return (
    <>
      {note}
      {have.length ? (
        <section className="tz-stk-box">
          <header><b>Prodejte hned</b><span className="t-small muted">Tyhle karty máte. Kusy mimo prodej dáte jedním klikem na prodej a kdo kartu hlídá, dostane upozornění.</span></header>
          <div className="tz-table-wrap">
            <table className="tz-table">
              <thead><tr><th>Karta</th><th>Chce koupit</th><th className="tz-num">Na prodej</th><th className="tz-num">Mimo prodej</th><th className="tz-num">Trh</th><th /></tr></thead>
              <tbody>
                {have.map((d) => (
                  <tr key={d.cardId}>
                    <td><Card c={d} /></td>
                    <td><b>{lidi(d.wanters)}</b>{d.recent ? <small className="tz-stk-up"> +{d.recent} za týden</small> : null}</td>
                    <td className="tz-num">{d.onSale} ks</td>
                    <td className="tz-num">{d.keep} ks</td>
                    <td className="tz-num">{d.market != null ? formatPrice(d.market) : '–'}</td>
                    <td>{d.keep > 0 && canSell ? <Button size="sm" disabled={pending} onClick={() => run(() => demandSell(owner, d.cardId))}>Dát na prodej</Button> : d.keep > 0 ? null : <span className="tz-stk-pay is-ok">Na prodej</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {missing.length ? (
        <section className="tz-stk-box">
          <header><b>Hledají a vy nemáte</b><span className="t-small muted">Tipy na výkup a nákup: karty, které lidé chtějí a vy je ve skladu nemáte.</span></header>
          <div className="tz-table-wrap">
            <table className="tz-table">
              <thead><tr><th>Karta</th><th>Hra</th><th>Chce koupit</th><th className="tz-num">Trh</th><th className="tz-num">Nejlevnější nabídka</th></tr></thead>
              <tbody>
                {missing.slice(0, 100).map((d) => (
                  <tr key={d.cardId}>
                    <td><Card c={d} /></td>
                    <td className="tz-muted">{d.game ? getGame(d.game)?.name ?? d.game : ''}</td>
                    <td><b>{lidi(d.wanters)}</b>{d.recent ? <small className="tz-stk-up"> +{d.recent} za týden</small> : null}</td>
                    <td className="tz-num">{d.market != null ? formatPrice(d.market) : '–'}</td>
                    <td className="tz-num">{d.low != null ? formatPrice(d.low) : <span className="tz-stk-muted">nikdo nenabízí</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

// ===== Celý trh =====

function Market({ data, q, days }: { data: { top: DemandCard[]; games: { game_id: string; wanters: number; recent: number }[] }; q: string; days: number }) {
  const max = Math.max(1, ...data.games.map((g) => g.wanters));
  return (
    <>
      <div className="tz-stk-tools">
        <span className="t-small muted">Přibylo za</span>
        {[7, 30].map((d) => <Link key={d} className="tz-stk-fbtn" aria-pressed={days === d} href={href(q, { pohled: 'trh', dni: d === 7 ? undefined : d })}>{d} dní</Link>)}
      </div>
      <div className="tz-stk-mk">
        <section className="tz-stk-box">
          <header><b>Poptávka podle her</b><span className="t-small muted">Lidé, kteří kartu z hry hledají nebo hlídají</span></header>
          {data.games.length ? data.games.map((g) => (
            <div key={g.game_id} className="tz-stk-bar" title={`${getGame(g.game_id)?.name ?? g.game_id}: ${g.wanters}`}>
              <span>{getGame(g.game_id)?.name ?? g.game_id}</span>
              <span className="tz-stk-prog"><i style={{ width: `${(g.wanters / max) * 100}%` }} /></span>
              <b className="tz-stk-code">{formatNumber(g.wanters)}</b>
              <small className={g.recent ? 'tz-stk-up' : 'tz-stk-muted'}>+{g.recent}</small>
            </div>
          )) : <p className="t-small muted">Zatím nikdo nic nehledá.</p>}
        </section>
        <section className="tz-stk-box">
          <header><b>Nejhledanější karty</b><span className="t-small muted">Celý V4cards, seřazeno podle počtu lidí</span></header>
          {data.top.length ? (
            <div className="tz-table-wrap">
              <table className="tz-table">
                <thead><tr><th>Karta</th><th className="tz-num">Hledá</th><th className="tz-num">Nově</th><th className="tz-num">Nabídek</th><th className="tz-num">Od</th><th className="tz-num">Trh</th></tr></thead>
                <tbody>
                  {data.top.slice(0, 50).map((d) => (
                    <tr key={d.cardId}>
                      <td><Card c={d} /></td>
                      <td className="tz-num">{d.wanters}</td>
                      <td className={`tz-num ${d.recent ? 'tz-stk-up' : 'tz-muted'}`}>+{d.recent}</td>
                      <td className="tz-num">{d.offers ?? 0}</td>
                      <td className="tz-num">{d.low != null ? formatPrice(d.low) : '–'}</td>
                      <td className="tz-num">{d.market != null ? formatPrice(d.market) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="t-small muted">Zatím nikdo nic nehledá.</p>}
        </section>
      </div>
    </>
  );
}

// ===== Vaše ceny =====

type PriceFilter = 'all' | 'over' | 'under' | 'old';

function Prices({ rows, canEdit }: { rows: PriceRow[]; canEdit: boolean }) {
  const [f, setF] = useState<PriceFilter>('all');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const withMarket = rows.filter((r) => r.market != null);
  const over = withMarket.filter((r) => r.price > r.market! * 1.05);
  const under = withMarket.filter((r) => r.price < r.market! * 0.95);
  const old = rows.filter((r) => (r.days ?? 0) > 60);
  const list = useMemo(() => {
    const l = f === 'over' ? over : f === 'under' ? under : f === 'old' ? old : rows;
    return [...l].sort((a, b) => Math.abs(b.price - (b.market ?? b.price)) - Math.abs(a.price - (a.market ?? a.price)));
  }, [f, rows, over, under, old]);
  const apply = (r: PriceRow) => start(async () => {
    const res = await stockChange([r.id], 'price', r.recommended!);
    setMsg(res.error ?? `${r.name}: cena ${formatPrice(r.recommended!)}.`);
  });
  if (!rows.length) return <div className="tz-stk-empty"><b>Nic na prodej</b>Až dáte karty na prodej s cenou, porovnáme je tady s trhem.</div>;
  return (
    <>
      <div className="tz-stk-strip">
        <div><small>Karet na prodej</small><b>{rows.length}</b></div>
        <div><small>Dražší než trh (o 5 % a víc)</small><b>{over.length}</b></div>
        <div><small>Levnější než trh</small><b>{under.length}</b></div>
        <div><small>Leží přes 60 dní</small><b>{old.length}</b></div>
      </div>
      <div className="tz-stk-tools">
        {([['all', 'Vše'], ['over', 'Dražší než trh'], ['under', 'Levnější než trh'], ['old', 'Leží přes 60 dní']] as [PriceFilter, string][]).map(([k, l]) => (
          <button key={k} type="button" className="tz-stk-fbtn" aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>
        ))}
        <span className="t-small muted">Doporučená cena: trh −3 %, u karet ležících přes 60 dní −5 %, nikdy pod nejlevnější nabídkou ve stejném stavu.</span>
      </div>
      {msg ? <p className="tz-stk-msg is-ok" role="status">{msg}</p> : null}
      <div className="tz-table-wrap">
        <table className="tz-table">
          <thead><tr><th>Karta</th><th>Stav</th><th className="tz-num">Kusů</th><th className="tz-num">Vaše cena</th><th className="tz-num">Trh</th><th className="tz-num">Proti trhu</th><th className="tz-num">Nejlevnější</th><th className="tz-num">Leží</th><th className="tz-num">Doporučená</th><th /></tr></thead>
          <tbody>
            {list.slice(0, 300).map((r) => {
              const d = r.market ? Math.round((r.price / r.market - 1) * 100) : null;
              return (
                <tr key={r.id}>
                  <td><Card c={r} /></td>
                  <td><span className="tz-stk-cond">{r.condition}</span> <span className="t-small muted">{LANGUAGE_NAMES[r.language as Language] ?? r.language}</span></td>
                  <td className="tz-num">{r.quantity}</td>
                  <td className="tz-num">{formatPrice(r.price)}</td>
                  <td className="tz-num">{r.market != null ? formatPrice(r.market) : '–'}</td>
                  <td className={`tz-num ${d == null || Math.abs(d) < 5 ? 'tz-muted' : d > 0 ? 'tz-stk-down' : 'tz-stk-up'}`}>{d == null ? '–' : `${d > 0 ? '+' : ''}${d} %`}</td>
                  <td className="tz-num">{r.low != null ? formatPrice(r.low) : '–'}</td>
                  <td className="tz-num">{r.days != null ? `${r.days} d` : '–'}</td>
                  <td className="tz-num">{r.recommended != null ? formatPrice(r.recommended) : '–'}</td>
                  <td>{canEdit && r.recommended != null && r.recommended !== r.price ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => apply(r)}>Použít</Button> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ===== Automatické ceny =====

function Auto({ owner, data, places, canEdit }: { owner: string; data: { rules: AutoRules; changes: AutoChange[] }; places: string[]; canEdit: boolean }) {
  const { pending, run, note } = useRun();
  const [r, setR] = useState<AutoRules>(data.rules);
  const set = <K extends keyof AutoRules>(k: K, v: AutoRules[K]) => setR((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'exclLocations' | 'exclGames', v: string) => setR((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const ex = Math.round(100 * (r.mode === 'under' ? 1 - r.pct / 100 : r.mode === 'over' ? 1 + r.pct / 100 : 1));
  const up = data.changes.filter((c) => c.next > c.old).length;
  return (
    <>
      <section className="tz-stk-box">
        <header>
          <b>Hlídat ceny automaticky</b>
          <span className="t-small muted">Každou noc ve 3:00 nastavíme ceny karet na prodej podle pravidel. Ráno uvidíte změny v Historii a každou jde vrátit.{r.lastRun ? ` Naposledy ${formatDateTime(r.lastRun)}.` : ''}</span>
        </header>
        <label className="tz-stk-check"><input type="checkbox" checked={r.enabled} disabled={!canEdit} onChange={(e) => set('enabled', e.target.checked)} /><span>Zapnuto</span></label>
        <div className="tz-stk-rule">
          <b>1 · Za kolik prodávat</b>
          <div className="tz-stk-tools">
            {([['under', 'Pod cenou trhu'], ['market', 'Tržní cena'], ['over', 'Nad cenou trhu']] as [AutoRules['mode'], string][]).map(([k, l]) => (
              <button key={k} type="button" className="tz-stk-fbtn" aria-pressed={r.mode === k} disabled={!canEdit} onClick={() => set('mode', k)}>{l}</button>
            ))}
            {r.mode !== 'market' ? <span className="tz-stk-cnt"><span className="t-small muted">o</span><input type="number" min={0} max={50} step={0.5} value={r.pct} disabled={!canEdit} onChange={(e) => set('pct', Number(e.target.value))} /><span className="t-small muted">%</span></span> : null}
          </div>
          <span className="t-small muted">Příklad: karta s tržní cenou 100 Kč bude u vás za {ex} Kč. Tržní cena je průměr prodejů z cenové historie karty.</span>
        </div>
        <div className="tz-stk-rule">
          <b>2 · Pojistky</b>
          <div className="tz-stk-tools">
            <span className="t-small">Nejnižší cena: nákupní +</span>
            <span className="tz-stk-cnt"><input type="number" min={0} max={500} value={r.floorPct} disabled={!canEdit} onChange={(e) => set('floorPct', Number(e.target.value))} /><span className="t-small muted">%</span></span>
            <span className="t-small">Největší změna za noc</span>
            <span className="tz-stk-cnt"><input type="number" min={1} max={50} value={r.capPct} disabled={!canEdit} onChange={(e) => set('capPct', Number(e.target.value))} /><span className="t-small muted">%</span></span>
          </div>
          <span className="t-small muted">Karty bez nákupní ceny (doplníte v detailu karty) hlídá jen největší změna za noc.</span>
        </div>
        <div className="tz-stk-rule">
          <b>3 · Neměnit vůbec</b>
          <div className="tz-stk-tools">
            {GAMES.map((g) => <label key={g.id} className="tz-stk-check"><input type="checkbox" checked={r.exclGames.includes(g.id)} disabled={!canEdit} onChange={() => toggle('exclGames', g.id)} /><span>{g.name}</span></label>)}
          </div>
          {places.length ? (
            <div className="tz-stk-tools">
              <span className="t-small muted">Místa:</span>
              {places.map((p) => <label key={p} className="tz-stk-check"><input type="checkbox" checked={r.exclLocations.includes(p)} disabled={!canEdit} onChange={() => toggle('exclLocations', p)} /><span>{p}</span></label>)}
            </div>
          ) : null}
        </div>
        {note}
        {canEdit ? <div className="tz-stk-tools" style={{ justifyContent: 'flex-end' }}><Button disabled={pending} onClick={() => run(() => autopriceSave(owner, r))}>Uložit pravidla</Button></div> : <p className="t-small muted">Pravidla mění, kdo má právo Napojení, export a automatické ceny.</p>}
      </section>
      <section className="tz-stk-box">
        <header><b>Co se stane dnes v noci</b><span className="t-small muted">Náhled podle uložených pravidel{data.changes.length ? `: ${up} dráž, ${data.changes.length - up} levněji` : ''}.</span></header>
        {data.changes.length ? (
          <div className="tz-table-wrap">
            <table className="tz-table">
              <thead><tr><th>Karta</th><th>Stav</th><th className="tz-num">Teď</th><th className="tz-num">Nově</th><th className="tz-num">Trh</th><th>Proč</th></tr></thead>
              <tbody>
                {data.changes.slice(0, 200).map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b> <small className="tz-stk-code tz-stk-muted">{c.set}</small></td>
                    <td><span className="tz-stk-cond">{c.condition}</span></td>
                    <td className="tz-num">{formatPrice(c.old)}</td>
                    <td className={`tz-num ${c.next > c.old ? 'tz-stk-up' : 'tz-stk-down'}`}>{formatPrice(c.next)}</td>
                    <td className="tz-num">{formatPrice(c.market)}</td>
                    <td className="tz-muted">{c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="t-small muted">{data.rules.lastRun || data.rules.enabled ? 'Podle pravidel se dnes v noci nic nezmění.' : 'Uložte pravidla a ukážeme, které ceny by se změnily.'}</p>}
      </section>
    </>
  );
}
