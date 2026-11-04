'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import type { CardLite } from '@/lib/import/rows';
import { CONDITIONS } from '@/lib/types';
import { searchImportCards } from './import/actions';
import { CARD_LANGS, LANG_FULL, Modal, Seg, nf, plw } from './sk';
import { deleteUnmatched, ignoreUnmatched, resolveUnmatched } from './unmatched-actions';

export interface Unm {
  id: number;
  file: string | null;
  line: number | null;
  reason: 'none' | 'multi' | 'data';
  game: string | null;
  name: string | null;
  setCode: string | null;
  setName: string | null;
  number: string | null;
  condition: string | null;
  language: string | null;
  rawCondition: string | null;
  rawLanguage: string | null;
  price: number | null;
  quantity: number;
  candidates: CardLite[];
  ignored: boolean;
}

const MX = 8;
const raw = (u: Unm) => [u.name, [u.setCode || u.setName, u.number].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || `Řádek ${u.line ?? ''}`;
const sub = (c: CardLite) => `${[c.setCode, c.number].filter(Boolean).join(' ')} · ${getGame(c.game)?.name ?? ''}`;

const norm = (x: string | null | undefined) => (x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const numKey = (x: string | null | undefined) => norm((x ?? '').split('/')[0]).replace(/\s/g, '').replace(/^0+(?=\d)/, '');
/** Podobnost názvů 0–1 (Dice nad dvojicemi písmen). */
function dice(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bi = (x: string) => { const m = new Map<string, number>(); for (let i = 0; i < x.length - 1; i++) { const k = x.slice(i, i + 2); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const A = bi(a), B = bi(b);
  let both = 0;
  A.forEach((n, k) => { both += Math.min(n, B.get(k) ?? 0); });
  const tot = Math.max(1, a.length - 1 + b.length - 1);
  return (2 * both) / tot;
}
/** Shoda řádku tabulky s kartou z katalogu v % (název, sada, číslo; co v tabulce chybí, se nepočítá). */
export function matchScore(u: Pick<Unm, 'name' | 'setCode' | 'setName' | 'number'>, c: CardLite) {
  const parts: [number, number][] = [];
  if (norm(u.name)) parts.push([50, dice(norm(u.name), norm(c.name))]);
  if (norm(u.setCode) || norm(u.setName)) {
    const code = norm(u.setCode) && norm(u.setCode) === norm(c.setCode);
    parts.push([25, code ? 1 : norm(u.setName) ? dice(norm(u.setName), norm(c.setName)) : 0]);
  }
  if (numKey(u.number)) parts.push([25, numKey(u.number) === numKey(c.number) ? 1 : 0]);
  const w = parts.reduce((t, [x]) => t + x, 0);
  return w ? Math.round((parts.reduce((t, [x, v]) => t + x * v, 0) / w) * 100) : 0;
}
/** Shoda navržené karty. */
const scoreOf = (u: Unm) => (u.candidates[0] ? matchScore(u, u.candidates[0]) : 0);
/** Víc verzí karty se stejnou shodou: místo Potvrdit / Jiná karta se jen vybere jedna z nich. */
const isMulti = (u: Unm) => u.reason === 'multi' && u.candidates.length > 1;
const toneOf = (sc: number): 'lo' | 'md' | '' => (sc >= 80 ? '' : sc >= 50 ? 'md' : 'lo');

/** Co u položky chybí (pod shodou). */
function why(u: Unm): [string, 'lo' | 'md' | ''] {
  if (u.reason === 'none') return ['Nenalezeno', 'lo'];
  if (u.reason === 'multi') return [`${u.candidates.length} verze karty`, 'md'];
  const miss = [!u.condition && (u.rawCondition ? `stav „${u.rawCondition}“` : 'stav'), !u.language && (u.rawLanguage ? `jazyk „${u.rawLanguage}“` : 'jazyk')].filter(Boolean);
  return [miss.length ? `Chybí ${miss.join(', ')}` : 'Zkontrolujte', 'md'];
}

/** Nespárované: řádky z tabulky, které nešly rovnou do skladu. Podle prototypu (K párování / Ignorované, filtr podle souboru). */
export function UnmatchedView({ items, shop }: { items: Unm[]; shop: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<'p' | 'i'>('p');
  const [file, setFile] = useState('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pick, setPick] = useState<Unm | null>(null);
  const [ver, setVer] = useState<Unm | null>(null);
  const [toast, setToast] = useState<{ t: string; err?: boolean } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { if (!toast) return; const x = setTimeout(() => setToast(null), 6000); return () => clearTimeout(x); }, [toast]);

  const wait = items.filter((u) => !u.ignored);
  const ign = items.filter((u) => u.ignored);
  const V = view === 'i' && ign.length ? 'i' : 'p';
  const LV = V === 'i' ? ign : wait;
  const src = (u: Unm) => u.file || 'Tabulka';
  const files = [...new Set(LV.map(src))];
  const F = file === 'all' || files.includes(file) ? file : 'all';
  const U = LV.filter((u) => F === 'all' || src(u) === F);
  const where = shop ? 'do skladu' : 'do sbírky';

  const run = (fn: () => Promise<{ error?: string }>, ok: string) => start(async () => {
    const r = await fn();
    setToast(r.error ? { t: r.error, err: true } : { t: ok });
    router.refresh();
  });

  function confirm(u: Unm) {
    const c = u.candidates[0];
    if (u.reason === 'multi' || !c || !u.condition || !u.language) { setPick(u); return; }
    run(async () => {
      const r = await resolveUnmatched(u.id, c.id, u.condition!, u.language!, u.quantity, u.price);
      return r.error ? r : {};
    }, `${c.name}: přidáno ${where}`);
  }

  if (!items.length) {
    return (
      <div className="tbl"><div className="none">
        Všechno je spárované. Řádky tabulky, které se nepodaří spárovat s katalogem, se tu objeví samy.{' '}
        <Link href="/prodat/import" style={{ color: 'var(--accent)' }}>Nahrát tabulku</Link>
      </div></div>
    );
  }

  const top = (
    <div className="top" style={{ marginBottom: 12, alignItems: 'center', gap: 12 }}>
      <Seg value={V} onChange={setView} style={{ width: 340 }} options={[['p', `K párování (${nf(wait.length)})`], ['i', `Ignorované (${nf(ign.length)})`]]} />
      <div className="bar" style={{ margin: '0 auto 0 0' }}>
        {[['all', 'Vše', LV.length] as const, ...files.map((x) => [x, x, LV.filter((u) => src(u) === x).length] as const)].map(([k, t, n]) => (
          <button key={k} type="button" className={`chip${F === k ? ' on' : ''}`} onClick={() => setFile(k)}>{t} <span style={{ opacity: 0.6 }}>{nf(n)}</span></button>
        ))}
      </div>
      <small style={{ color: 'var(--ink-muted)' }}>{V === 'p' ? `Co potvrdíte, přijde ${where}.` : ''}</small>
    </div>
  );

  const origin = (u: Unm) => (
    <div className="umr">
      <b>{raw(u)}</b>
      <small><span className="usrc">Tabulka</span>{[u.file, u.line ? `řádek ${u.line}` : ''].filter(Boolean).join(' · ')}</small>
    </div>
  );

  if (V === 'i') {
    return (
      <>
        {top}
        <div className="tbl">
          <div className="umh" style={{ borderTop: 0 }}>
            <div><b>Ignorované <span>{nf(ign.length)}</span></b><small>Zůstávají jen v tabulce. {shop ? 'Do skladu' : 'Do sbírky'} se nepřenesou a nebudou se znovu nabízet k párování.</small></div>
            <button type="button" className="btn sm g lcdl" disabled={pending} onClick={() => run(() => deleteUnmatched(U.map((u) => u.id)), `Smazáno: ${plw(U.length, ['položka', 'položky', 'položek'])}`)}>Smazat {F === 'all' ? 'všechny' : 'tyto'}</button>
          </div>
          {U.map((u) => (
            <div key={u.id} className="um2 umig">
              {origin(u)}<span /><span /><span />
              <div className="ua2"><button type="button" className="btn sm" disabled={pending} onClick={() => run(() => ignoreUnmatched([u.id], false), `Vráceno k párování: ${raw(u)}`)}>Vrátit k párování</button></div>
            </div>
          ))}
        </div>
        {toast ? <div className={`toast${toast.err ? ' err' : ''}`} role="status">{toast.t}</div> : null}
      </>
    );
  }

  const row = (u: Unm) => {
    const c = u.candidates[0];
    const [w, tone] = why(u);
    const sure = u.reason !== 'multi' && !!c && !!u.condition && !!u.language && scoreOf(u) >= 80;
    return (
      <div key={u.id} className="um2">
        {origin(u)}
        <span className="uar">→</span>
        <div className="ums">
          {isMulti(u) ? <><span className="stk">{u.candidates.slice(0, 3).map((x) => x.image ? <img key={x.id} src={thumbUrl(x.image) ?? x.image} alt="" /> : null)}</span><span><b>{c.name}</b><small>Vyberte z {nf(u.candidates.length)} verzí</small></span></>
          : c ? <>{c.image ? <img src={thumbUrl(c.image) ?? c.image} alt="" /> : null}<span><b>{c.name}</b><small className="mono">{sub(c)}</small></span></>
            : <span><b style={{ color: 'var(--ink-muted)' }}>V katalogu nenalezeno</b><small>Najděte kartu ručně</small></span>}
        </div>
        <div>
          {c ? <div className={`ump ${toneOf(scoreOf(u))}`} title="Jak moc karta z katalogu odpovídá názvu, sadě a číslu v tabulce"><i style={{ '--w': `${scoreOf(u)}%` } as React.CSSProperties} /><b className="mono">{scoreOf(u)} %</b></div> : null}
          <small style={{ display: 'block', fontSize: 11.5, marginTop: c ? 3 : 0, color: tone === 'lo' ? 'var(--down)' : 'var(--ink-muted)' }}>{w}</small>
        </div>
        {isMulti(u) ? (
          <div className="ua2">
            <button type="button" className="btn sm g mut" disabled={pending} onClick={() => run(() => ignoreUnmatched([u.id], true), `Ignorováno: ${raw(u)}. Najdete to v záložce Ignorované.`)}>Ignorovat</button>
            <button type="button" className="btn sm p" disabled={pending} onClick={() => setVer(u)}>Vybrat verzi</button>
          </div>
        ) : <div className="ua2">
          <button type="button" className="btn sm g" onClick={() => setPick(u)}>{c ? 'Jiná karta' : 'Najít kartu'}</button>
          <button type="button" className="btn sm g mut" disabled={pending} onClick={() => run(() => ignoreUnmatched([u.id], true), `Ignorováno: ${raw(u)}. Najdete to v záložce Ignorované.`)}>Ignorovat</button>
          {c ? <button type="button" className={`btn sm${sure ? ' p' : ''}`} disabled={pending} onClick={() => confirm(u)}>Potvrdit</button> : null}
        </div>}
      </div>
    );
  };
  const sec = (id: string, t: string, d: string, L: Unm[], btn?: React.ReactNode) => {
    if (!L.length) return null;
    const LL = open[id] ? L : L.slice(0, MX);
    return (
      <>
        <div className="umh"><div><b>{t} <span>{nf(L.length)}</span></b><small>{d}</small></div>{btn}</div>
        {LL.map(row)}
        {L.length > MX ? <button type="button" className="ummore" onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>{open[id] ? 'Zobrazit méně' : `Zobrazit všech ${nf(L.length)}`}</button> : null}
      </>
    );
  };
  // Jako v prototypu: Zkontrolujte (pod 80 % nebo něco chybí, nejnejistější první) a Skoro jisté (jde rovnou potvrdit).
  const isSure = (u: Unm) => u.reason !== 'multi' && !!u.candidates[0] && !!u.condition && !!u.language && scoreOf(u) >= 80;
  const vers = U.filter(isMulti);
  const check = U.filter((u) => !isSure(u) && !isMulti(u)).sort((a, b) => scoreOf(a) - scoreOf(b));
  const ready = U.filter(isSure).sort((a, b) => scoreOf(a) - scoreOf(b));

  function confirmAll() {
    run(async () => {
      let n = 0;
      for (const u of ready) {
        const r = await resolveUnmatched(u.id, u.candidates[0].id, u.condition!, u.language!, u.quantity, u.price);
        if (r.error) return { error: n ? `Přidáno ${n}, zbytek se nepodařilo uložit: ${r.error}` : r.error };
        n++;
      }
      return {};
    }, `Přidáno ${where}: ${plw(ready.length, ['karta', 'karty', 'karet'])}`);
  }

  return (
    <>
      {top}
      {U.length ? (
        <div className="tbl">
          <div className="um2 oth"><span>Z tabulky</span><span /><span>Navrhujeme</span><span>Shoda</span><span /></div>
          {sec('check', 'Zkontrolujte', 'Shoda pod 80 % nebo chybí stav či jazyk. Nejnejistější jsou nahoře.', check)}
          {sec('ver', 'Vyberte verzi', 'Tabulce odpovídá víc verzí stejné karty. Klikněte na Vybrat verzi a vyberte tu svou podle obrázku.', vers)}
          {sec('sure', 'Skoro jisté', 'Karta sedí a údaje jsou kompletní. Stačí potvrdit.', ready,
            <button type="button" className="btn sm p" disabled={pending} onClick={confirmAll}>{ready.length > 1 ? `Potvrdit všech ${nf(ready.length)}` : 'Potvrdit'}</button>)}
        </div>
      ) : <div className="tbl"><div className="none">{wait.length ? 'V tomto filtru nic nečeká.' : 'Všechno je spárované nebo ignorované.'}</div></div>}
      {ver ? <VersionModal u={ver} shop={shop} onOther={() => { setPick(ver); setVer(null); }} onClose={() => setVer(null)} onDone={(t, err) => { setToast({ t, err }); if (!err) { setVer(null); router.refresh(); } }} /> : null}
      {pick ? <PickModal u={pick} shop={shop} onClose={() => setPick(null)} onDone={(t, err) => { setToast({ t, err }); if (!err) { setPick(null); router.refresh(); } }} /> : null}
      {toast ? <div className={`toast${toast.err ? ' err' : ''}`} role="status">{toast.t}</div> : null}
    </>
  );
}

/** Vyberte verzi: velké obrázky všech verzí, kliknutím je hotovo. Stav a jazyk jen když v tabulce chyběly. */
function VersionModal({ u, shop, onOther, onClose, onDone }: { u: Unm; shop: boolean; onOther: () => void; onClose: () => void; onDone: (t: string, err?: boolean) => void }) {
  const [cond, setCond] = useState(u.condition ?? 'NM');
  const [lang, setLang] = useState(u.language && CARD_LANGS.includes(u.language) ? u.language : 'en');
  const [pending, start] = useTransition();
  const choose = (c: CardLite) => start(async () => {
    const r = await resolveUnmatched(u.id, c.id, cond, lang, u.quantity, u.price);
    if (r.error) onDone(r.error, true);
    else onDone(`${c.name} (${[c.setCode, c.number].filter(Boolean).join(' ')}): přidáno ${shop ? 'do skladu' : 'do sbírky'}`);
  });
  return (
    <Modal title="Která verze to je?" wide onClose={onClose} foot={<>
      <button type="button" className="btn g" onClick={onOther}>Žádná z nich, hledat jinou</button>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
    </>}>
      <div className="umsrc">
        <small>Řádek z tabulky</small>
        <b>{raw(u)}</b>
        <span className="mono">{[u.file, u.line ? `řádek ${u.line}` : '', `${nf(u.quantity)} ks`, u.condition, u.language ? LANG_FULL[u.language] ?? u.language : ''].filter(Boolean).join(' · ')}</span>
      </div>
      {!u.condition || !u.language ? (
        <div className="grid2" style={{ marginTop: 14 }}>
          {!u.condition ? <div className="f"><label>Stav{u.rawCondition ? ` (v tabulce „${u.rawCondition}“)` : ''}</label>
            <Seg value={cond} onChange={setCond} options={CONDITIONS.map((x) => [x, x] as [string, string])} />
          </div> : null}
          {!u.language ? <div className="f"><label>Jazyk{u.rawLanguage ? ` (v tabulce „${u.rawLanguage}“)` : ''}</label>
            <div className="inp" style={{ height: 36 }}>
              <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ background: 'none', border: 0, flex: 1, font: '600 14px var(--fs)' }} aria-label="Jazyk">
                {CARD_LANGS.map((l) => <option key={l} value={l}>{LANG_FULL[l]}</option>)}
              </select>
            </div>
          </div> : null}
        </div>
      ) : null}
      <div className="umv" style={{ marginTop: 14 }}>
        {u.candidates.map((c) => (
          <button key={c.id} type="button" disabled={pending} onClick={() => choose(c)}>
            <span className="im">{c.image ? <img src={thumbUrl(c.image) ?? c.image} alt="" /> : null}</span>
            <span><b>{c.name}</b><small>{c.setName}</small><small className="mono">{[c.setCode, c.number].filter(Boolean).join(' · ')}</small></span>
            <span className="pick">Je to tahle</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** Jiná karta / Najít kartu: hledání v katalogu, stav, jazyk, počet a cena. */
function PickModal({ u, shop, onClose, onDone }: { u: Unm; shop: boolean; onClose: () => void; onDone: (t: string, err?: boolean) => void }) {
  const [q, setQ] = useState([u.name || u.setCode || u.setName, u.number].filter(Boolean).join(' '));
  const [found, setFound] = useState<CardLite[] | null>(null);
  const [cond, setCond] = useState(u.condition ?? 'NM');
  const [lang, setLang] = useState(u.language && CARD_LANGS.includes(u.language) ? u.language : 'en');
  const [qty, setQty] = useState(String(u.quantity));
  const [price, setPrice] = useState(u.price != null ? String(u.price) : '');
  const [pending, start] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) { setFound(null); return; }
    const x = setTimeout(() => { searchImportCards(q, u.game ?? undefined).then(setFound, () => setFound([])); }, 250);
    return () => clearTimeout(x);
  }, [q, u.game]);

  const list = [...u.candidates, ...(found ?? []).filter((c) => !u.candidates.some((x) => x.id === c.id))];
  const n = Number(qty);
  const p = price ? Number(price) : null;
  const okQty = Number.isInteger(n) && n >= 1;

  function choose(c: CardLite) {
    start(async () => {
      const r = await resolveUnmatched(u.id, c.id, cond, lang, n, p);
      if (r.error) onDone(r.error, true);
      else onDone(`${c.name}: ${r.sale ? 'vystaveno na prodej' : `přidáno ${shop ? 'do skladu' : 'do sbírky'}${p != null ? ' mimo prodej (doplňte dopravu a platbu)' : ''}`}`);
    });
  }

  return (
    <Modal title={u.candidates.length ? 'Vybrat jinou kartu' : 'Najít kartu'} wide onClose={onClose} foot={<>
      <span className="note">Bez ceny přijde karta {shop ? 'do skladu' : 'do sbírky'} mimo prodej.</span>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
    </>}>
      <div className="umsrc">
        <small>Řádek z tabulky</small>
        <b>{raw(u)}</b>
        <span className="mono">{[u.file, u.line ? `řádek ${u.line}` : ''].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="grid2" style={{ marginTop: 14 }}>
        <div className="f"><label>Stav{!u.condition && u.rawCondition ? ` (v tabulce „${u.rawCondition}“)` : ''}</label>
          <Seg value={cond} onChange={setCond} options={CONDITIONS.map((c) => [c, c] as [string, string])} />
        </div>
        <div className="f"><label>Jazyk{!u.language && u.rawLanguage ? ` (v tabulce „${u.rawLanguage}“)` : ''}</label>
          <div className="inp" style={{ height: 36 }}>
            <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ background: 'none', border: 0, flex: 1, font: '600 14px var(--fs)' }} aria-label="Jazyk">
              {CARD_LANGS.map((l) => <option key={l} value={l}>{LANG_FULL[l]}</option>)}
            </select>
          </div>
        </div>
        <div className="f"><label>Počet kusů</label>
          <div className="inp" style={{ height: 36 }}><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} aria-label="Počet kusů" /><em>ks</em></div>
        </div>
        <div className="f"><label>Cena za kus</label>
          <div className="inp" style={{ height: 36 }}><input inputMode="numeric" placeholder="bez ceny" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} aria-label="Cena za kus" /><em>Kč</em></div>
        </div>
      </div>
      <div className="inp" style={{ margin: '14px 0 10px' }}>
        <input placeholder="Hledat kartu: název, sada nebo číslo" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="umal">
        {list.length ? list.map((c, k) => (
          <div key={c.id} className="umar">
            {c.image ? <img src={thumbUrl(c.image) ?? c.image} alt="" /> : <span style={{ width: 30 }} />}
            <span><b>{c.name}</b><small className="mono">{sub(c)}</small></span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>shoda {matchScore(u, c)} %</span>
            {k < u.candidates.length ? <span className="usrc">Náš návrh</span> : null}
            <button type="button" className="btn sm" disabled={pending || !okQty} onClick={() => choose(c)}>Vybrat</button>
          </div>
        )) : <div className="none" style={{ padding: 20 }}>{found ? 'Nic nenalezeno. Zkuste jiný název nebo číslo.' : 'Napište název, sadu nebo číslo karty.'}</div>}
      </div>
      <small className="wsm" style={{ display: 'block', marginTop: 10 }}>Hledá se v celém katalogu V4cards.</small>
    </Modal>
  );
}
