'use client';

import { useEffect, useRef, useState } from 'react';
import { getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { createClient } from '@/lib/supabase/browser';
import { COND_FULL, Modal, Seg, kc, nf } from './sk';

/**
 * Okna z pruhu nad tabulkou podle prototypu: Podrobnosti (Kusů celkem, Druhů, Na prodej) a Hodnota v čase.
 * Data počítá databáze (stock_detail, stock_value_detail), vývoj z nočních záznamů stock_daily (od 4. 11. 2026).
 */

type Pt = [string, number];
type Row = [string, number];

const sbRpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T | null> => {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T | null;
};

const dd = (iso: string, year = false) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.getDate()}. ${d.getMonth() + 1}.${year ? ` ${d.getFullYear()}` : ''}`;
};
const today = () => new Date().toISOString().slice(0, 10);

/** Spojnicový graf jako v prototypu (lineCh): mřížka, popisky, tečka na konci, bublina po najetí. */
function LineChart({ pts, fmt, unit, height = 200, year = false }: { pts: Pt[]; fmt: 'kc' | 'n'; unit?: string; height?: number; year?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hov, setHov] = useState<number | null>(null);
  const n = pts.length, W = 820, H = height, pl = 8, pr = 8, pt = 12, pb = 26;
  const v = pts.map((p) => p[1]);
  const mx = Math.max(...v), mn = Math.min(...v), span = mx - mn || Math.max(1, mx * 0.02);
  const lo = mn - span * 0.15, hi = mx + span * 0.1;
  const X = (k: number) => pl + (k * (W - pl - pr)) / Math.max(1, n - 1);
  const Y = (y: number) => pt + (1 - (y - lo) / (hi - lo)) * (H - pt - pb);
  const F = (y: number) => (fmt === 'kc' ? kc(Math.round(y)) : nf(Math.round(y)));
  const d = v.map((y, k) => `${k ? 'L' : 'M'}${X(k).toFixed(1)} ${Y(y).toFixed(1)}`).join(' ');
  const grid = [0, 1, 2].map((j) => lo + (hi - lo) * (0.2 + j * 0.3));
  const xl = [0, Math.round((n - 1) / 2), n - 1];
  const at = hov ?? n - 1;
  const move = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * W;
    setHov(Math.max(0, Math.min(n - 1, Math.round(((x - pl) / (W - pl - pr)) * (n - 1)))));
  };
  return (
    <div ref={ref} className={`vch${height === 200 ? ' sm' : ''}`} onMouseMove={move} onMouseLeave={() => setHov(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {grid.map((y) => (
          <g key={y}>
            <line x1={pl} x2={W - pr} y1={Y(y).toFixed(1)} y2={Y(y).toFixed(1)} className="vgl" />
            <text x={pl + 4} y={(Y(y) - 5).toFixed(1)} className="vgt">{F(y)}</text>
          </g>
        ))}
        <path d={`${d} L${X(n - 1)} ${H - pb} L${X(0)} ${H - pb}Z`} fill="color-mix(in srgb,var(--accent) 10%,transparent)" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {xl.map((k, j) => (
          <text key={j} x={X(k)} y={H - 6} className="vgt" textAnchor={(['start', 'middle', 'end'] as const)[j]}>{k === n - 1 ? 'dnes' : dd(pts[k][0], year)}</text>
        ))}
      </svg>
      <i className="vdot" style={{ left: `${(X(at) / W) * 100}%`, top: `${(Y(v[at]) / H) * 100}%` }} />
      {hov != null ? (
        <div className={`vtip${X(at) / W > 0.6 ? ' r' : ''}`} style={{ display: 'block', left: `${(X(at) / W) * 100}%` }}>
          <small>{pts[at][0] === today() ? 'dnes' : dd(pts[at][0], true)}</small>
          <b className="mono">{F(v[at])}{unit ? <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}> {unit}</span> : null}</b>
        </div>
      ) : null}
    </div>
  );
}

/** Místo grafu, dokud nejsou aspoň dva dny záznamů. */
function FewData({ height = 200 }: { height?: number }) {
  return (
    <div className="vch" style={{ height, cursor: 'default', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 20 }}>
      <div>
        <b style={{ display: 'block', marginBottom: 4 }}>Zatím málo dat</b>
        <span className="wsm">Vývoj zapisujeme každou noc od 4. 11. 2026. První porovnání uvidíte zítra, celý graf postupně.</span>
      </div>
    </div>
  );
}

function Bars({ rows, unit, empty }: { rows: Row[]; unit?: '%'; empty?: string }) {
  const mx = Math.max(1, ...rows.map((r) => r[1]));
  if (!rows.length) return <p className="wsm" style={{ margin: '6px 0' }}>{empty ?? 'Zatím nic.'}</p>;
  return (
    <>
      {rows.map(([l, v]) => (
        <div key={l} className="mkgr">
          <span>{l}</span>
          <span className="mkb"><i style={{ width: `${(v / mx) * 100}%` }} /></span>
          <b className="mono">{unit === '%' ? `${v} %` : nf(v)}</b>
          <span className="mono mkdn" />
        </div>
      ))}
    </>
  );
}

const Box = ({ t, sub, children }: { t: string; sub?: string; children: React.ReactNode }) => (
  <div>
    <div className="mvh">{t}</div>
    {sub ? <p className="wsm" style={{ margin: '-2px 0 8px' }}>{sub}</p> : null}
    {children}
  </div>
);

const chgPct = (a: number, b: number) => {
  if (!a) return null;
  const c = Math.round((b / a - 1) * 1000) / 10;
  return `${c >= 0 ? '+' : '−'}${String(Math.abs(c)).replace('.', ',')} %`;
};

type Detail = {
  cur: { pcs: number; kinds: number; sale: number };
  pts: Pt[]; games: Row[]; gameShare: Row[]; conds: Row[]; places: Row[]; sets: Row[]; top: Row[]; per: Row[]; interest: Row[];
  notSale: { noPrice: number; keep: number; locked: number; orders: number };
  ages: Row[]; moves: { added: number; sold: number };
};

const gname = (rows: Row[]) => rows.map(([g, n]) => [getGame(g)?.name ?? g, n] as Row);

/** Podrobnosti ke Kusům celkem (0), Druhům (1) a Na prodej (2). */
export function StockDetailModal({ owner, k, shop, onClose }: { owner: string; k: 0 | 1 | 2; shop: boolean; onClose: () => void }) {
  const [h, setH] = useState<'7' | '30' | '90'>('90');
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setErr(false);
    sbRpc<Detail>('stock_detail', { p_owner: owner, p_k: k, p_days: Number(h) })
      .then((x) => { if (live) setD(x); })
      .catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [owner, k, h]);

  const title = k === 0 ? 'Kusů celkem' : k === 1 ? 'Druhy karet' : 'Na prodej';
  const val = d ? (k === 0 ? d.cur.pcs : k === 1 ? d.cur.kinds : d.cur.sale) : 0;
  const label = k === 0 ? (shop ? 'Kusů ve skladu' : 'Kusů ve sbírce') : k === 1 ? 'Různých karet a variant'
    : `Kusů na prodej · ${d && d.cur.pcs ? Math.round((d.cur.sale / d.cur.pcs) * 100) : 0} % ${shop ? 'skladu' : 'sbírky'}`;
  const pts = d?.pts ?? [];
  const ch = pts.length > 1 ? chgPct(pts[0][1], pts[pts.length - 1][1]) : null;
  const unit = k === 0 ? 'ks' : k === 1 ? 'druhů' : 'ks na prodej';
  const ns = d?.notSale;
  const why: Row[] = ns ? (shop
    ? [['Bez ceny', ns.noPrice], ['Odloženo stranou', ns.keep], ['Zablokované', ns.locked], ['V objednávkách', ns.orders]]
    : [['Nechávám si', ns.noPrice + ns.keep], ['Zablokované', ns.locked], ['V objednávkách', ns.orders]]).filter((r) => Number(r[1]) > 0) as Row[] : [];

  return (
    <Modal title={title} wide onClose={onClose} foot={<button type="button" className="btn" onClick={onClose}>Zavřít</button>}>
      {err ? <p className="wsm">Podrobnosti se nepodařilo načíst. Zkuste to prosím znovu.</p> : !d ? <p className="wsm">Načítám…</p> : (
        <>
          <div className="vhh">
            <div><small>{label}</small><b className="mono">{nf(val)}</b><span className="acc">{ch ? `${ch} za ${h} dní` : <span className="muted">vývoj od zítřka</span>}</span></div>
            <Seg value={h} onChange={setH} style={{ width: 270 }} options={[['7', '7 dní'], ['30', '30 dní'], ['90', '90 dní']]} />
          </div>
          {pts.length > 1 ? <LineChart pts={pts} fmt="n" unit={unit} /> : <FewData />}
          {k === 0 ? (
            <>
              <div className="mvg">
                <Box t="Podle her"><Bars rows={gname(d.games)} /></Box>
                <Box t="Podle stavu"><Bars rows={d.conds.map(([c, n]) => [`${COND_FULL[c] ?? c} (${c})`, n] as Row)} /></Box>
              </div>
              <div className="mvg">
                <Box t="Kde leží" sub="největší umístění"><Bars rows={d.places.map(([p, n]) => [p === '—' ? 'Bez umístění' : p, n] as Row)} /></Box>
                <Box t={`Pohyb za ${h} dní`}><Bars rows={[['Nově přidáno', d.moves.added], ['Prodáno', d.moves.sold]]} /></Box>
              </div>
            </>
          ) : k === 1 ? (
            <>
              <div className="mvg">
                <Box t="Podle her"><Bars rows={gname(d.games)} /></Box>
                <Box t="Nejvíc druhů ze sady"><Bars rows={d.sets} /></Box>
              </div>
              <div className="mvg">
                <Box t="Nejvíc kusů od jedné karty"><Bars rows={d.top} /></Box>
                <Box t="Kolik kusů má jeden druh"><Bars rows={d.per} /></Box>
              </div>
            </>
          ) : (
            <>
              <div className="mvg">
                <Box t="Podíl na prodej podle her"><Bars rows={gname(d.gameShare)} unit="%" /></Box>
                {shop
                  ? <Box t="Kde se prodává" sub="kusy viditelné v kanálu"><Bars rows={[['V4cards', d.cur.sale]]} /></Box>
                  : <Box t="Zájem o vaše karty" sub="lidé, kteří je hlídají"><Bars rows={d.interest} empty="Vaše karty na prodej zatím nikdo nehlídá." /></Box>}
              </div>
              <div className="mvg">
                <Box t="Proč zbytek není na prodej"><Bars rows={why} empty="Všechno je na prodej." /></Box>
                <Box t="Jak dlouho leží na prodej"><Bars rows={d.ages} /></Box>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

type Mover = { id: string; name: string; code: string | null; number: string | null; img: string | null; n: number; c: number };
type ValueData = { now: number; pts: Pt[]; up: Mover[]; down: Mover[] };
const VP = { '30': ['30 dní', 30], '90': ['90 dní', 90], '365': ['1 rok', 365] } as const;

/** Hodnota v čase (sbírky, skladu, nebo nabídky na záložce Na prodej). */
export function ValueModal({ owner, off, shop, onClose, onCard }: { owner: string; off: boolean; shop: boolean; onClose: () => void; onCard: (cardId: string) => void }) {
  const [p, setP] = useState<keyof typeof VP>('90');
  const [d, setD] = useState<ValueData | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setErr(false);
    sbRpc<ValueData>('stock_value_detail', { p_owner: owner, p_off: off, p_days: VP[p][1] })
      .then((x) => { if (live) setD(x); })
      .catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [owner, off, p]);

  // Za rok po týdnech (jako v prototypu), jinak po dnech.
  const raw = d?.pts ?? [];
  const pts = p === '365' && raw.length > 60 ? raw.filter((_, k) => (raw.length - 1 - k) % 7 === 0) : raw;
  const end = d?.now ?? 0, st = pts.length > 1 ? pts[0][1] : end;
  const diff = end - st, pc = chgPct(st, end);
  const title = off ? 'Hodnota nabídky v čase' : shop ? 'Hodnota skladu v čase' : 'Hodnota sbírky v čase';
  const row = (m: Mover) => (
    <div key={m.id} className="mvr" style={{ cursor: 'pointer', gridTemplateColumns: '26px minmax(0,1fr) auto', padding: '6px 0' }} onClick={() => { onClose(); onCard(m.id); }} title="Otevřít kartu">
      {m.img ? <img src={thumbUrl(m.img) ?? m.img} alt="" /> : <img alt="" />}
      <span className="mkt"><b>{m.name}</b><small className="mono">{[m.code, m.number].filter(Boolean).join(' ')} · {nf(m.n)} ks{off ? ' na prodej' : ''}</small></span>
      <b className={`mono ${m.c >= 0 ? 'acc' : 'neg'}`}>{m.c >= 0 ? '+' : '−'}{kc(Math.abs(m.c))}</b>
    </div>
  );

  return (
    <Modal title={title} wide onClose={onClose} foot={<button type="button" className="btn" onClick={onClose}>Zavřít</button>}>
      {err ? <p className="wsm">Hodnotu se nepodařilo načíst. Zkuste to prosím znovu.</p> : !d ? <p className="wsm">Načítám…</p> : (
        <>
          <div className="vhh">
            <div>
              <small>{off ? 'Dnes podle vašich cen' : 'Dnes podle trhu'}</small>
              <b className="mono">{kc(end)}</b>
              <span className="acc">{pts.length > 1 && pc ? `${diff >= 0 ? '+' : '−'}${kc(Math.abs(diff))} (${pc}) za ${VP[p][0]}` : <span className="muted">vývoj od zítřka</span>}</span>
            </div>
            <Seg value={p} onChange={setP} options={Object.entries(VP).map(([k, [t]]) => [k as keyof typeof VP, t])} />
          </div>
          {pts.length > 1 ? <LineChart pts={pts} fmt="kc" height={220} year={p === '365'} /> : <FewData height={220} />}
          <div className="mvg">
            <div><div className="mvh">Táhne hodnotu nahoru</div>{d.up.length ? d.up.map(row) : <p className="wsm">Zatím málo dat o cenách.</p>}</div>
            <div><div className="mvh">Táhne hodnotu dolů</div>{d.down.length ? d.down.map(row) : <p className="wsm">Zatím málo dat o cenách.</p>}</div>
          </div>
          <p className="wsm" style={{ marginTop: 12 }}>
            {off
              ? 'Počítáme každou noc z vašich prodejních cen, jen u kusů na prodej. Přidání nebo stažení karet z prodeje se do grafu nepočítá jako růst nebo pokles. Změna'
              : 'Počítáme každou noc z tržních cen na V4cards, i u karet, které nemáte na prodej. Změna'} počtu kusů (prodej, naskladnění) se do grafu nepočítá jako růst nebo pokles.
          </p>
        </>
      )}
    </Modal>
  );
}
