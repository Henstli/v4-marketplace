'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { BulkBar, Button, CardThumb, Status } from '@/components/trezor';
import { fold } from '@/lib/import/columns';
import { formatDate, formatNumber, formatPrice, plural } from '@/lib/format';
import { GAMES } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { CONDITIONS, LANGUAGE_NAMES, type Language } from '@/lib/types';
import { stockChange, stockSet, type BulkResult, type StockOp } from './actions';
import type { StockRow } from './data';

const PAGE = 100;
/** Ležák: na prodej déle než 60 dní */
const SLOW_DAYS = 60;

type Sale = 'all' | 'on' | 'off' | 'empty';
type Sort = 'new' | 'name' | 'value' | 'price' | 'qty' | 'old';
interface Filters { games: string[]; conds: string[]; sale: Sale; trade: boolean; slow: boolean; noPrice: boolean; location: string }
const NO_FILTERS: Filters = { games: [], conds: [], sale: 'all', trade: false, slow: false, noPrice: false, location: '' };

const has = (r: StockRow) => r.quantity + r.keep > 0 || r.hidden != null;
const total = (r: StockRow) => r.quantity + r.keep + (r.hidden ?? 0);
const unit = (r: StockRow) => r.market ?? r.price ?? 0;
const days = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0);
const isSlow = (r: StockRow) => r.quantity > 0 && days(r.listedAt) > SLOW_DAYS;
const locked = (r: StockRow) => r.removed || r.hidden != null;
const langName = (l: string) => LANGUAGE_NAMES[l as Language] ?? l;
const kc = (n: number) => formatPrice(Math.round(n));
const karet = (n: number) => plural(n, ['karta', 'karty', 'karet']);

/**
 * Sklad (obchod) a Sbírka (sběratel): souhrn, hledání, filtry, tabulka, hromadné úpravy a detail karty.
 * mode 'sale' = záložka Na prodej (jen kusy na prodej, ceny proti trhu, ležáky).
 */
export function StockManager({ items, mode, shop, ready }: { items: StockRow[]; mode: 'all' | 'sale'; shop: boolean; ready: boolean }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filters>(mode === 'sale' ? { ...NO_FILTERS, sale: 'on' } : NO_FILTERS);
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<Sort>('new');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [pct, setPct] = useState('-10');
  const [price, setPrice] = useState('');
  const [loc, setLoc] = useState('');

  const sale = mode === 'sale';
  const base = useMemo(() => (sale ? items.filter((r) => r.quantity > 0 || r.hidden != null) : items), [items, sale]);
  const locations = useMemo(() => [...new Set(items.map((r) => r.location).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'cs')), [items]);
  const gamesHere = useMemo(() => GAMES.filter((g) => items.some((r) => r.card?.game === g.id)), [items]);

  const filtered = useMemo(() => {
    const t = fold(q);
    const list = base.filter((r) => {
      if (f.sale === 'empty' && has(r)) return false;
      if (f.sale === 'all' && !sale && !has(r)) return false;
      if (f.sale === 'on' && r.quantity <= 0 && r.hidden == null) return false;
      if (f.sale === 'off' && r.keep <= 0) return false;
      if (f.games.length && !f.games.includes(r.card?.game ?? '')) return false;
      if (f.conds.length && !f.conds.includes(r.condition)) return false;
      if (f.trade && r.trade <= 0) return false;
      if (f.slow && !isSlow(r)) return false;
      if (f.noPrice && r.price != null) return false;
      if (f.location && r.location !== f.location) return false;
      if (t && !fold([r.card?.name, r.card?.setName, r.card?.setCode, r.card?.number, r.location].filter(Boolean).join(' ')).includes(t)) return false;
      return true;
    });
    const by: Record<Sort, (a: StockRow, b: StockRow) => number> = {
      new: () => 0,
      old: (a, b) => (a.listedAt ?? a.createdAt).localeCompare(b.listedAt ?? b.createdAt),
      name: (a, b) => (a.card?.name ?? '').localeCompare(b.card?.name ?? '', 'cs'),
      value: (a, b) => unit(b) * total(b) - unit(a) * total(a),
      price: (a, b) => (b.price ?? 0) - (a.price ?? 0),
      qty: (a, b) => total(b) - total(a),
    };
    return sort === 'new' ? list : [...list].sort(by[sort]);
  }, [base, f, q, sort, sale]);

  useEffect(() => setPage(0), [f, q, sort]);

  // Souhrn nad celým skladem (ne nad filtrem), aby čísla neskákala.
  const sum = useMemo(() => {
    let pcs = 0, kinds = 0, value = 0, onSale = 0, saleValue = 0, off = 0, trade = 0, slow = 0, noPrice = 0, rows = 0, empty = 0, below = 0;
    for (const r of items) {
      if (!has(r)) { empty++; continue; }
      kinds++;
      pcs += total(r);
      value += unit(r) * total(r);
      off += r.keep;
      if (r.trade > 0) trade += Math.min(r.trade, total(r));
      if (r.quantity > 0) {
        rows++;
        onSale += r.quantity;
        saleValue += (r.price ?? r.market ?? 0) * r.quantity;
        if (isSlow(r)) slow++;
        if (r.price == null) noPrice++;
        if (r.price != null && r.market && r.price < r.market * 0.9) below++;
      }
    }
    return { pcs, kinds, value, onSale, saleValue, off, trade, slow, noPrice, rows, empty, below };
  }, [items]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const ids = [...selected].filter((id) => items.some((i) => i.id === id && !locked(i)));
  const allShown = shown.length > 0 && shown.filter((r) => !locked(r)).every((r) => selected.has(r.id));
  const active = f.games.length + f.conds.length + (f.trade ? 1 : 0) + (f.slow ? 1 : 0) + (f.noPrice ? 1 : 0) + (f.location ? 1 : 0)
    + (!sale && f.sale !== 'all' ? 1 : 0);
  const current = detail ? items.find((r) => r.id === detail) ?? null : null;

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => {
      const n = new Set(s);
      for (const r of shown) { if (locked(r)) continue; if (allShown) n.delete(r.id); else n.add(r.id); }
      return n;
    });
  }
  function run(op: StockOp, value?: number | string, done?: string) {
    setMsg(null);
    start(async () => {
      const res: BulkResult = await stockChange(ids, op, value);
      if (res.error) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: `${done ?? 'Upraveno'}: ${karet(res.count ?? 0)}. Vrátit to jde v Historii.` });
        if (op === 'remove') setSelected(new Set());
      }
    });
  }
  const flip = <K extends 'games' | 'conds'>(k: K, v: string) =>
    setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));

  const pills: { label: string; clear: () => void }[] = [
    ...f.games.map((g) => ({ label: GAMES.find((x) => x.id === g)?.name ?? g, clear: () => flip('games', g) })),
    ...f.conds.map((c) => ({ label: `Stav ${c}`, clear: () => flip('conds', c) })),
    ...(!sale && f.sale === 'on' ? [{ label: 'Na prodej', clear: () => setF((x) => ({ ...x, sale: 'all' })) }] : []),
    ...(!sale && f.sale === 'off' ? [{ label: 'Mimo prodej', clear: () => setF((x) => ({ ...x, sale: 'all' })) }] : []),
    ...(!sale && f.sale === 'empty' ? [{ label: 'Vyprodané a stažené', clear: () => setF((x) => ({ ...x, sale: 'all' })) }] : []),
    ...(f.trade ? [{ label: 'Na výměnu', clear: () => setF((x) => ({ ...x, trade: false })) }] : []),
    ...(f.slow ? [{ label: `Ležáky (přes ${SLOW_DAYS} dní)`, clear: () => setF((x) => ({ ...x, slow: false })) }] : []),
    ...(f.noPrice ? [{ label: 'Bez ceny', clear: () => setF((x) => ({ ...x, noPrice: false })) }] : []),
    ...(f.location ? [{ label: `Místo ${f.location}`, clear: () => setF((x) => ({ ...x, location: '' })) }] : []),
  ];

  const word = shop ? 'skladu' : 'sbírky';

  return (
    <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {sale ? (
        <div className="tz-stk-strip">
          <button type="button" onClick={() => setF({ ...NO_FILTERS, sale: 'on' })}><small>Na prodej</small><b>{formatNumber(sum.onSale)}</b><em>ks · {plural(sum.rows, ['nabídka', 'nabídky', 'nabídek'])}</em></button>
          <div><small>Hodnota nabídky</small><b>{kc(sum.saleValue)}</b></div>
          <button type="button" onClick={() => setF({ ...NO_FILTERS, sale: 'on', slow: true })}><small>Ležáky (přes {SLOW_DAYS} dní)</small><b>{formatNumber(sum.slow)}</b></button>
          <button type="button" onClick={() => setF({ ...NO_FILTERS, sale: 'on', noPrice: true })}><small>Cena dohodou</small><b>{formatNumber(sum.noPrice)}</b></button>
          <div><small>Levněji než trh</small><b>{formatNumber(sum.below)}</b></div>
        </div>
      ) : (
        <div className="tz-stk-strip">
          <button type="button" onClick={() => setF(NO_FILTERS)}><small>{shop ? 'Kusů ve skladu' : 'Karet ve sbírce'}</small><b>{formatNumber(sum.pcs)}</b><em>{plural(sum.kinds, ['druh', 'druhy', 'druhů'])}</em></button>
          <div><small>Hodnota {word} (trh)</small><b>{kc(sum.value)}</b></div>
          <button type="button" onClick={() => setF({ ...NO_FILTERS, sale: 'on' })}><small>Na prodej</small><b>{formatNumber(sum.onSale)}</b><em>ks{sum.pcs ? ` · ${Math.round((sum.onSale / sum.pcs) * 100)} %` : ''}</em></button>
          <button type="button" onClick={() => setF({ ...NO_FILTERS, sale: 'off' })}><small>Mimo prodej</small><b>{formatNumber(sum.off)}</b><em>ks</em></button>
          <button type="button" onClick={() => setF({ ...NO_FILTERS, trade: true })}><small>Na výměnu</small><b>{formatNumber(sum.trade)}</b><em>ks</em></button>
        </div>
      )}

      <div className="tz-stk-tools">
        <input
          className="tz-stk-search"
          type="search"
          placeholder={`Hledat ve ${shop ? 'skladu' : 'sbírce'}: název, sada, číslo${shop ? ', místo' : ''}`}
          aria-label="Hledat"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="tz-stk-fbtn" aria-pressed={open} onClick={() => setOpen(!open)}>
          Filtry{active ? <span className="tz-stk-n">{active}</span> : null}
        </button>
        <select className="tz-stk-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Řadit">
          <option value="new">Nejnovější</option>
          <option value="old">{sale ? 'Nejdéle na prodej' : 'Nejstarší'}</option>
          <option value="name">Podle názvu</option>
          <option value="value">Nejvyšší hodnota</option>
          <option value="price">Nejvyšší cena</option>
          <option value="qty">Nejvíc kusů</option>
        </select>
      </div>

      {open ? (
        <div className="tz-stk-filters">
          {gamesHere.length > 1 ? (
            <fieldset><legend>Hra</legend>
              {gamesHere.map((g) => <label key={g.id}><input type="checkbox" checked={f.games.includes(g.id)} onChange={() => flip('games', g.id)} />{g.name}</label>)}
            </fieldset>
          ) : null}
          <fieldset><legend>Stav karty</legend>
            {CONDITIONS.map((c) => <label key={c}><input type="checkbox" checked={f.conds.includes(c)} onChange={() => flip('conds', c)} />{c}</label>)}
          </fieldset>
          {!sale ? (
            <fieldset><legend>Prodej</legend>
              {([['all', 'Vše'], ['on', 'Na prodej'], ['off', 'Mimo prodej'], ['empty', `Vyprodané a stažené (${sum.empty})`]] as [Sale, string][]).map(([v, l]) => (
                <label key={v}><input type="radio" name="sale" checked={f.sale === v} onChange={() => setF((x) => ({ ...x, sale: v }))} />{l}</label>
              ))}
            </fieldset>
          ) : null}
          <fieldset><legend>Další</legend>
            <label><input type="checkbox" checked={f.trade} onChange={(e) => setF((x) => ({ ...x, trade: e.target.checked }))} />Na výměnu</label>
            <label><input type="checkbox" checked={f.slow} onChange={(e) => setF((x) => ({ ...x, slow: e.target.checked }))} />Ležáky (přes {SLOW_DAYS} dní)</label>
            <label><input type="checkbox" checked={f.noPrice} onChange={(e) => setF((x) => ({ ...x, noPrice: e.target.checked }))} />Bez ceny / dohodou</label>
          </fieldset>
          {shop && locations.length ? (
            <fieldset><legend>Umístění</legend>
              <select className="tz-stk-select" value={f.location} onChange={(e) => setF((x) => ({ ...x, location: e.target.value }))}>
                <option value="">Všechna místa</option>
                {locations.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </fieldset>
          ) : null}
        </div>
      ) : null}

      {pills.length ? (
        <div className="tz-stk-pills">
          {pills.map((p) => <span key={p.label} className="tz-stk-pill">{p.label}<button type="button" onClick={p.clear} aria-label={`Zrušit filtr ${p.label}`}>×</button></span>)}
          <Button variant="ghost" size="sm" onClick={() => setF(sale ? { ...NO_FILTERS, sale: 'on' } : NO_FILTERS)}>Zrušit filtry</Button>
        </div>
      ) : null}

      <div className="tz-table-wrap">
        <table className="tz-table">
          <thead>
            <tr>
              <th className="tz-check"><input type="checkbox" checked={allShown} onChange={toggleAll} aria-label="Vybrat všechny zobrazené" /></th>
              <th>Karta</th>
              <th>Stav</th>
              <th>Jazyk</th>
              {shop && !sale ? <th>Místo</th> : null}
              {sale ? null : <th className="tz-num">Mám</th>}
              <th>{sale ? 'Na prodej' : 'Prodej'}</th>
              <th className="tz-num">Cena</th>
              <th className="tz-num">Trh</th>
              {sale ? <th className="tz-num">Na prodeji</th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const diff = r.price != null && r.market ? Math.round(((r.price - r.market) / r.market) * 100) : null;
              return (
                <tr key={r.id} className="tz-stk-row" aria-selected={selected.has(r.id) ? 'true' : 'false'} onClick={() => setDetail(r.id)}>
                  <td className="tz-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" disabled={locked(r)} checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Vybrat ${r.card?.name ?? 'kartu'}`} />
                  </td>
                  <td>
                    <span className="tz-stk-card">
                      <CardThumb size="sm" image={thumbUrl(r.card?.image ?? undefined)} preview={r.card?.image ?? undefined}
                        color={r.card?.game ? `var(--game-${r.card.game}-art, var(--surface-sunken))` : undefined} />
                      <span>
                        <b>{r.card?.name ?? 'Karta'}{r.trade > 0 ? <span className="tz-stk-trade">Výměna {Math.min(r.trade, total(r))}</span> : null}</b>
                        {r.card ? <small>{r.card.setName} · <span className="tz-stk-code">{r.card.setCode} {r.card.number}</span></small> : null}
                      </span>
                    </span>
                  </td>
                  <td><span className="tz-stk-cond">{r.condition}</span></td>
                  <td className="tz-muted">{langName(r.language)}</td>
                  {shop && !sale ? <td className="tz-muted">{r.location ?? '–'}</td> : null}
                  {sale ? null : <td className="tz-num">{formatNumber(total(r))}</td>}
                  <td>
                    {r.removed ? <Status tone="warn">Odstraněno podporou</Status>
                      : r.hidden != null ? <Status tone="warn">Skrytá podporou</Status>
                      : r.quantity > 0 ? <span className="tz-stk-sale">{r.quantity} ks{r.keep > 0 && !sale ? ` z ${total(r)}` : ''}</span>
                      : has(r) ? <span className="tz-stk-sale is-off">Mimo prodej</span>
                      : <span className="tz-stk-sale is-off">Vyprodáno</span>}
                  </td>
                  <td className="tz-num">{r.price != null ? kc(r.price) : <span className="tz-stk-muted">{r.quantity > 0 ? 'Dohodou' : '–'}</span>}</td>
                  <td className="tz-num">
                    {r.market ? kc(r.market) : <span className="tz-stk-muted">–</span>}
                    {sale && diff != null && Math.abs(diff) >= 5 ? <small className={diff > 0 ? 'tz-stk-down' : 'tz-stk-up'}> {diff > 0 ? '+' : '−'}{Math.abs(diff)} %</small> : null}
                  </td>
                  {sale ? <td className={`tz-num ${isSlow(r) ? 'tz-stk-down' : 'tz-muted'}`}>{r.listedAt ? plural(days(r.listedAt), ['den', 'dny', 'dní']) : '–'}</td> : null}
                </tr>
              );
            })}
            {!shown.length ? (
              <tr><td colSpan={10} className="tz-muted">{items.length ? 'Nic neodpovídá hledání nebo filtrům.' : `Ve ${shop ? 'skladu' : 'sbírce'} zatím nic není.`}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Předchozí</Button>
          <span className="t-small muted">Strana {page + 1} z {pages} · {karet(filtered.length)}</span>
          <Button variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Další</Button>
        </div>
      ) : null}

      {msg ? <p className={`tz-stk-msg ${msg.ok ? 'is-ok' : 'is-err'}`} role="status">{msg.text}</p> : null}

      {ids.length ? (
        <BulkBar count={ids.length} onClear={() => setSelected(new Set())}>
          <span className="tz-bulkbar-group">
            <input className="tz-cell-input tz-num" style={{ width: 64 }} inputMode="decimal" aria-label="Změna ceny v procentech" value={pct} onChange={(e) => setPct(e.target.value)} />
            <span>%</span>
            <Button variant="secondary" disabled={pending || !Number(pct.replace(',', '.'))} onClick={() => run('pct', Number(pct.replace(',', '.')), 'Cena změněna')}>Změnit cenu</Button>
          </span>
          <span className="tz-bulkbar-group">
            <input className="tz-cell-input tz-num" style={{ width: 72 }} inputMode="numeric" placeholder="Kč" aria-label="Nová cena za kus" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
            <Button variant="secondary" disabled={pending || !price} onClick={() => run('price', Number(price), 'Cena nastavena')}>Nastavit cenu</Button>
          </span>
          {sale ? null : <Button variant="secondary" disabled={pending || !ready} title={ready ? undefined : 'Nejdřív doplňte dopravu a platbu'} onClick={() => run('sell', undefined, 'Na prodej')}>+ Prodávat</Button>}
          <Button variant="secondary" disabled={pending} onClick={() => run('unsell', undefined, 'Staženo z prodeje')}>Stáhnout z prodeje</Button>
          <Button variant="secondary" disabled={pending} onClick={() => run('trade_all', undefined, 'Na výměnu')}>Na výměnu</Button>
          <Button variant="ghost" disabled={pending} onClick={() => run('trade_none', undefined, 'Výměna zrušena')}>Zrušit výměnu</Button>
          {shop ? (
            <span className="tz-bulkbar-group">
              <input className="tz-cell-input" style={{ width: 96 }} placeholder="Místo" aria-label="Umístění" maxLength={60} value={loc} onChange={(e) => setLoc(e.target.value)} list="tz-stk-locs" />
              <datalist id="tz-stk-locs">{locations.map((l) => <option key={l} value={l} />)}</datalist>
              <Button variant="secondary" disabled={pending} onClick={() => run('location', loc, 'Umístění změněno')}>Přesunout</Button>
            </span>
          ) : null}
          <Button variant="danger" disabled={pending} onClick={() => {
            if (!window.confirm(`Opravdu odebrat ${karet(ids.length)} ze ${shop ? 'skladu' : 'sbírky'}? Tohle už vrátit nejde.`)) return;
            run('remove', undefined, 'Odebráno');
          }}>Odebrat</Button>
        </BulkBar>
      ) : null}

      {current ? <StockDrawer key={current.id} row={current} shop={shop} ready={ready} onClose={() => setDetail(null)} onSaved={(t) => setMsg({ ok: true, text: t })} /> : null}
    </div>
  );
}

function Stepper({ label, value, set, min = 0, max = 100000, disabled }: { label: string; value: number; set: (n: number) => void; min?: number; max?: number; disabled?: boolean }) {
  return (
    <div className="tz-stk-qbox">
      <small>{label}</small>
      <div className="tz-stk-stp">
        <button type="button" disabled={disabled || value <= min} onClick={() => set(value - 1)} aria-label={`${label} o jeden méně`}>−</button>
        <b>{value}</b>
        <button type="button" disabled={disabled || value >= max} onClick={() => set(value + 1)} aria-label={`${label} o jeden víc`}>+</button>
      </div>
    </div>
  );
}

/** Detail karty ve skladu: kusy na prodej / mimo prodej / na výměnu, cena, místo a nákupní cena. */
function StockDrawer({ row, shop, ready, onClose, onSaved }: { row: StockRow; shop: boolean; ready: boolean; onClose: () => void; onSaved: (t: string) => void }) {
  const [qty, setQty] = useState(row.quantity);
  const [keep, setKeep] = useState(row.keep);
  const [trade, setTrade] = useState(Math.min(row.trade, row.quantity + row.keep));
  const [price, setPrice] = useState(row.price != null ? String(row.price) : '');
  const [location, setLocation] = useState(row.location ?? '');
  const [buy, setBuy] = useState(row.buyPrice != null ? String(row.buyPrice) : '');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const lock = row.removed || row.hidden != null;
  const all = qty + keep;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  function save() {
    setErr('');
    if (qty > row.quantity && !ready) { setErr('Prodávat jde až s dopravou a platbou. Doplňte je v nastavení účtu.'); return; }
    start(async () => {
      const res = await stockSet(row.id, row.card?.name ?? 'karta', {
        quantity: qty, keep, trade: Math.min(trade, all),
        price: price ? Number(price) : null,
        ...(shop ? { location, buyPrice: buy ? Number(buy) : null } : {}),
      });
      if (res.error) setErr(res.error);
      else { onSaved(`Uloženo: ${row.card?.name ?? 'karta'}.`); onClose(); }
    });
  }

  return (
    <>
      <div className="tz-stk-drawer-bg" onClick={onClose} />
      <aside className="tz-stk-drawer" role="dialog" aria-modal="true" aria-label={row.card?.name ?? 'Karta'}>
        <header>
          <CardThumb size="lg" image={thumbUrl(row.card?.image ?? undefined)} color={row.card?.game ? `var(--game-${row.card.game}-art, var(--surface-sunken))` : undefined} />
          <div>
            <h2>{row.card?.name ?? 'Karta'}</h2>
            {row.card ? <p className="t-small muted">{row.card.setName} · <span className="tz-stk-code">{row.card.setCode} {row.card.number}</span></p> : null}
            <p className="t-small"><span className="tz-stk-cond">{row.condition}</span> {langName(row.language)}</p>
            {row.card ? <Link href={`/karty/${row.card.slug}`} className="t-small">Otevřít kartu v katalogu</Link> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Zavřít">Zavřít</Button>
        </header>
        <div className="tz-stk-drawer-body">
          {lock ? <Status tone="warn">{row.removed ? 'Nabídku odstranila podpora, upravit ji nejde.' : 'Nabídka je skrytá podporou, upravit ji nejde.'}</Status> : null}
          <div className="tz-stk-qty">
            <Stepper label="Na prodej" value={qty} set={setQty} disabled={lock} />
            <Stepper label="Mimo prodej" value={keep} set={setKeep} disabled={lock} />
            <Stepper label="Na výměnu" value={Math.min(trade, all)} set={setTrade} max={all} disabled={lock} />
          </div>
          <p className="t-small muted">Mám celkem {all} ks. Na výměnu můžou být i kusy na prodej: když se jeden prodá, ubude i z výměny.</p>
          {keep > 0 && !lock ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" size="sm" disabled={!ready} onClick={() => { setQty(qty + keep); setKeep(0); }}>+ Prodávat všech {all}</Button>
            </div>
          ) : qty > 0 && !lock ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={() => { setKeep(qty + keep); setQty(0); }}>Stáhnout vše z prodeje</Button>
            </div>
          ) : null}
          <label className="tz-stk-field">Cena za kus (Kč){qty > 0 ? '' : ', nepovinná'}
            <input inputMode="numeric" value={price} disabled={lock} placeholder={qty > 0 ? 'Prázdné = cena dohodou' : 'Bez ceny'} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
          </label>
          {shop ? (
            <div className="tz-stk-two">
              <label className="tz-stk-field">Umístění
                <input value={location} maxLength={60} disabled={lock} placeholder="např. Krabice A" onChange={(e) => setLocation(e.target.value)} />
              </label>
              <label className="tz-stk-field">Nákupní cena za kus (Kč)
                <input inputMode="numeric" value={buy} disabled={lock} onChange={(e) => setBuy(e.target.value.replace(/\D/g, ''))} />
              </label>
            </div>
          ) : null}
          <dl className="tz-stk-facts">
            <dt>Tržní cena</dt><dd>{row.market ? kc(row.market) : '–'}</dd>
            <dt>Hodnota (trh)</dt><dd>{row.market ? kc(row.market * all) : '–'}</dd>
            {shop && row.buyPrice != null ? <><dt>Nákupní hodnota</dt><dd>{kc(row.buyPrice * all)}</dd></> : null}
            <dt>Ve {shop ? 'skladu' : 'sbírce'} od</dt><dd>{formatDate(row.createdAt)}</dd>
            {row.quantity > 0 && row.listedAt ? <><dt>Na prodeji od</dt><dd>{formatDate(row.listedAt)}</dd></> : null}
          </dl>
          {err ? <p className="tz-stk-msg is-err" role="alert">{err}</p> : null}
        </div>
        <footer>
          <Button variant="ghost" onClick={onClose}>Zrušit</Button>
          <Button disabled={pending || lock} onClick={save}>{pending ? 'Ukládám…' : 'Uložit'}</Button>
        </footer>
      </aside>
    </>
  );
}
