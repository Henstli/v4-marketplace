'use client';

import { CONDITIONS } from '@/lib/types';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addPile, addSearch, type FoundCard } from './sk-actions';
import { autopriceSave, rolesSave, staffAdd, staffRemove, staffRole, type Res } from './team-actions';
import { PERMS, type Perm, type TeamData } from './team';
import type { AutoChange, AutoRules } from './market';
import { CARD_LANGS, Ico, kc, langCode, Modal, nf, plA, Seg } from './sk';

type Toast = (t: string, err?: boolean) => void;

/** Tlačítka v hlavičce Skladu a Sbírky a jejich okna, přesně podle prototypu. */
export function StockActions({ shop, owner, ownerName, me, meName, isOwner, role, roleLabel, canStaff, canConn, canAdd, napojeni, team, auto, places, gameNames, obchod, total }: {
  shop: boolean; owner: string; ownerName: string; me: string; meName: string; isOwner: boolean; role: string; roleLabel: string;
  canStaff: boolean; canConn: boolean; canAdd: boolean; napojeni: string; team: TeamData | null;
  auto: { rules: AutoRules; changes: AutoChange[] } | null; places: string[]; gameNames: string[]; obchod: string | null; total: number;
}) {
  const [m, setM] = useState<'staff' | 'rules' | 'export' | 'add' | null>(null);
  const [toast, setToastS] = useState<{ t: string; err?: boolean } | null>(null);
  const toastFn: Toast = (t, err) => setToastS({ t, err });
  useEffect(() => { if (!toast) return; const x = setTimeout(() => setToastS(null), 6000); return () => clearTimeout(x); }, [toast]);
  const close = () => setM(null);
  return (
    <>
      <div className="acts">
        {shop && role !== 'ved' ? <span className="urb"><span className="av">{(meName[0] ?? '?').toUpperCase()}</span>{meName} · {roleLabel}</span> : null}
        {shop && canStaff && team ? <button type="button" className="btn" onClick={() => setM('staff')}>Zaměstnanci</button> : null}
        {shop && canConn && auto ? (
          <button type="button" className={`btn autob${auto.rules.enabled ? ' on' : ''}`} onClick={() => setM('rules')}>{auto.rules.enabled ? <i className="pulse" /> : null}Automatické ceny</button>
        ) : null}
        {canConn ? <><button type="button" className="btn" onClick={() => setM('export')}>Exportovat</button><Link className="btn" href={napojeni}>Napojení</Link></> : null}
        {canAdd ? <button type="button" className="btn p" onClick={() => setM('add')}>+ Přidat karty</button> : null}
      </div>
      {m === 'staff' && team ? <StaffModal owner={owner} ownerName={ownerName} me={me} isOwner={isOwner} team={team} onClose={close} toast={toastFn} /> : null}
      {m === 'rules' && auto ? <RulesModal owner={owner} auto={auto} places={places} games={gameNames} onClose={close} toast={toastFn} /> : null}
      {m === 'export' ? <ExportModal shop={shop} selected={[]} filtered={null} total={total} obchod={obchod} onClose={close} /> : null}
      {m === 'add' ? <AddModal shop={shop} owner={isOwner ? '' : owner} onClose={close} toast={toastFn} /> : null}
      {toast ? <div className={`toast${toast.err ? ' err' : ''}`} role="status">{toast.t}</div> : null}
    </>
  );
}

/** Exportovat: co (vybrané, podle filtrů, všechno) a v jakém formátu. */
export function ExportModal({ shop, selected, filtered, total, obchod, onClose }: {
  shop: boolean; selected: string[]; filtered: string[] | null; total: number; obchod?: string | null; onClose: () => void;
}) {
  const [what, setWhat] = useState<'sel' | 'flt' | 'all'>(selected.length ? 'sel' : 'all');
  const F: [string, string, string][] = shop
    ? [['csv', 'CSV', 'Všechny sloupce, otevřete v Excelu, jde upravit a nahrát zpátky'], ['deckbuilder', 'Pro deckbuildery', 'Formát sbírky pro Moxfield (karty Magic)'],
      ['ucetni', 'Přehled pro účetní', 'Hodnota skladu k dnešku podle her (nákupní, prodejní, tržní) a obrat za 12 měsíců'],
      ['pojisteni', 'Přehled pro pojištění', 'Hodnota skladu k dnešku podle míst, nákupní i tržní hodnota']]
    : [['csv', 'CSV', 'Všechny sloupce, otevřete v Excelu, jde upravit a nahrát zpátky'], ['deckbuilder', 'Pro deckbuildery', 'Formát sbírky pro Moxfield (karty Magic)'],
      ['pojisteni', 'Přehled pro pojištění', 'Hodnota sbírky k dnešku s tržní cenou každé karty']];
  const [ef, setEf] = useState('csv');
  const ids = what === 'sel' ? selected : what === 'flt' ? filtered ?? [] : null;
  const form = useRef<HTMLFormElement>(null);
  const cap = (n: number) => (n > 9999 ? '9999+' : nf(n));
  return (
    <Modal title="Exportovat" onClose={onClose} foot={<>
      <span className="note">{ef === 'ucetni' ? 'Přehled pro účetní je vždy za celý sklad.' : shop ? 'Napojení e-shopů a dopravců najdete v Napojení.' : ''}</span>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
      <button type="button" className="btn p" onClick={() => { form.current?.submit(); onClose(); }}>Stáhnout</button>
    </>}>
      <form ref={form} method="post" action="/prodat/export" style={{ display: 'none' }}>
        <input name="druh" value={ef === 'csv' ? '' : ef} readOnly />
        <input name="ids" value={ids && ef !== 'ucetni' ? ids.join(',') : ''} readOnly />
        <input name="obchod" value={obchod ?? ''} readOnly />
      </form>
      <div className="f"><label>Co</label>
        <div className="seg">
          <button type="button" className={what === 'sel' ? 'on' : ''} disabled={!selected.length} onClick={() => setWhat('sel')}>Vybrané ({nf(selected.length)})</button>
          {filtered ? <button type="button" className={what === 'flt' ? 'on' : ''} onClick={() => setWhat('flt')}>Podle filtrů ({cap(filtered.length)})</button> : null}
          <button type="button" className={what === 'all' ? 'on' : ''} onClick={() => setWhat('all')}>Všechno ({cap(total)})</button>
        </div>
      </div>
      <div className="opt">
        {F.map(([k, n, d]) => <label key={k} className={ef === k ? 'on' : ''} onClick={() => setEf(k)}><span className="rd" /><span>{n}<small>{d}</small></span></label>)}
      </div>
    </Modal>
  );
}

/** Přidat karty: hledání v katalogu vlevo, hromádka vpravo, výchozí stav a jazyk. */
function AddModal({ shop, owner, onClose, toast }: { shop: boolean; owner: string; onClose: () => void; toast: Toast }) {
  const [mode, setMode] = useState<'name' | 'photo'>('name');
  const [q, setQ] = useState('');
  const [res, setRes] = useState<FoundCard[]>([]);
  const [hi, setHi] = useState(0);
  const [pile, setPile] = useState<{ c: FoundCard; n: number; cond: string; lang: string }[]>([]);
  const [cond, setCond] = useState('NM');
  const [lang, setLang] = useState('en');
  const [pending, start] = useTransition();
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim().length >= 2) addSearch(q).then((r) => { setRes(r); setHi(0); }).catch(() => setRes([])); else setRes([]); }, 220);
    return () => clearTimeout(t);
  }, [q]);
  const add = (c: FoundCard) => setPile((p) => {
    const k = p.findIndex((x) => x.c.id === c.id && x.cond === cond && x.lang === lang);
    if (k >= 0) return p.map((x, j) => (j === k ? { ...x, n: x.n + 1 } : x));
    return [...p, { c, n: 1, cond, lang }];
  });
  const pcs = pile.reduce((s, p) => s + p.n, 0);
  const save = () => start(async () => {
    const r = await addPile(owner, pile.map((p) => ({ cardId: p.c.id, n: p.n, cond: p.cond, lang: p.lang })));
    if (r.error) { toast(r.error, true); return; }
    toast(`Přidáno ${nf(r.count ?? pcs)} ks ${shop ? 'do skladu' : 'do sbírky'}`);
    router.refresh();
    onClose();
  });
  const pileBox = (
    <div className="pile">
      <h4>Hromádka <span style={{ color: 'var(--ink-muted)', fontWeight: 500 }}>{pcs} ks</span></h4>
      {pile.length ? pile.map((p, k) => (
        <div key={`${p.c.id}${p.cond}${p.lang}`} className="pi">
          {p.c.image ? <img src={p.c.image} alt="" /> : <img alt="" />}
          <span>{p.c.name}<small>{p.c.set} · {p.cond} · {langCode(p.lang)}</small></span>
          <span className="mini">
            <button type="button" onClick={() => setPile((x) => x.flatMap((y, j) => (j === k ? (y.n > 1 ? [{ ...y, n: y.n - 1 }] : []) : [y])))}>−</button>
            {p.n}
            <button type="button" onClick={() => setPile((x) => x.map((y, j) => (j === k ? { ...y, n: Math.min(999, y.n + 1) } : y)))}>+</button>
          </span>
        </div>
      )) : <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>Zatím prázdná. Karty přidávejte vlevo, stav a jazyk se pamatují z poslední karty.</span>}
      <div style={{ marginTop: 'auto' }} className="f">
        <label>Výchozí pro další karty</label>
        <div className="grid2">
          <Seg value={cond} onChange={setCond} options={CONDITIONS.map((x) => [x, x] as [string, string])} />
          <Seg value={lang} onChange={setLang} options={CARD_LANGS.slice(0, 3).map((l) => [l, langCode(l)] as [string, string])} />
        </div>
      </div>
    </div>
  );
  return (
    <Modal title="Přidat karty" wide onClose={onClose} foot={<>
      <span className="note">{shop ? 'Karty přijdou do skladu jako nevystavené.' : 'Karty přijdou do sbírky.'}</span>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
      <button type="button" className="btn p" disabled={!pile.length || pending} onClick={save}>Přidat {pcs} ks {shop ? 'do skladu' : 'do sbírky'}</button>
    </>}>
      {mode === 'photo' ? (
        <div className="addg ph">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Seg value={mode} onChange={setMode} style={{ width: '100%' }} options={[['name', 'Podle názvu'], ['photo', 'Z fotky']]} />
            <div className="none" style={{ padding: 24, color: 'var(--ink-muted)', fontSize: 13.5 }}>
              Rozpoznávání karet z fotky připravujeme. Zatím přidávejte podle názvu, nebo <Link href={owner ? `/prodat/import?obchod=${owner}` : '/prodat/import'} style={{ color: 'var(--accent)' }}>nahrajte tabulku</Link>.
            </div>
          </div>
          {pileBox}
        </div>
      ) : (
        <div className="addg">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Seg value={mode} onChange={setMode} style={{ width: '100%' }} options={[['name', 'Podle názvu'], ['photo', 'Z fotky']]} />
            <label className="search" style={{ width: '100%', margin: 0, height: 42 }}>{Ico.s}
              <input autoFocus value={q} placeholder="Název karty, sada nebo číslo" onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && res[hi]) { e.preventDefault(); add(res[hi]); }
                  if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(res.length - 1, h + 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
                }} />
            </label>
            <div className="res">
              {res.length ? res.map((c, k) => (
                <div key={c.id} className={`ri${k === hi ? ' on' : ''}`} onMouseEnter={() => setHi(k)}>
                  {c.image ? <img src={c.image} alt="" /> : <img alt="" />}
                  <span><b>{c.name}</b><small className="mono">{c.set}</small>{c.game ? <small> · {c.game}</small> : null}</span>
                  <button type="button" className={`btn sm${k === hi ? ' p' : ''}`} onClick={() => add(c)}>Přidat</button>
                </div>
              )) : <div className="none">{q.trim().length >= 2 ? 'Nic nenalezeno' : 'Napište název karty, sadu nebo číslo'}</div>}
            </div>
            <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}><span className="kbd">Enter</span> přidá první · <span className="kbd">↑ ↓</span> výběr</span>
            <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Hodně karet najednou? <Link href={owner ? `/prodat/import?obchod=${owner}` : '/prodat/import'} style={{ color: 'var(--accent)' }}>Nahrajte tabulku</Link>.
              {owner ? null : <> Kartu v katalogu nenajdete? <Link href="/prodat/nova-karta" style={{ color: 'var(--accent)' }}>Navrhněte ji</Link>.</>}</span>
          </div>
          {pileBox}
        </div>
      )}
    </Modal>
  );
}

const ROLES: [string, string][] = [['ved', 'Vedoucí'], ['pro', 'Prodavač'], ['skl', 'Skladník']];
const PGROUPS: [string, Perm[]][] = [['Sklad', ['view', 'add', 'price']], ['Prodej', ['ord', 'conn']], ['Inventura', ['inv', 'plan', 'diff']], ['Tým', ['staff']]];

/** Zaměstnanci a role: Lidé (role přepínačem, pozvat e-mailem) a Co smí role (přepínače, platí hned). */
function StaffModal({ owner, ownerName, me, isOwner, team, onClose, toast }: {
  owner: string; ownerName: string; me: string; isOwner: boolean; team: TeamData; onClose: () => void; toast: Toast;
}) {
  const [tab, setTab] = useState<'p' | 'r'>('p');
  const [email, setEmail] = useState('');
  const [perm, setPerm] = useState<Record<'pro' | 'skl', Set<Perm>>>({ pro: new Set(team.roles.pro), skl: new Set(team.roles.skl) });
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<Res>, ok?: string) => start(async () => {
    const r = await fn();
    if (r.error) toast(r.error, true); else { if (ok || r.text) toast(ok ?? r.text!); router.refresh(); }
  });
  const PT = Object.fromEntries(PERMS) as Record<Perm, string>;
  const flip = (rk: 'pro' | 'skl', k: Perm) => {
    const next = { pro: new Set(perm.pro), skl: new Set(perm.skl) };
    if (next[rk].has(k)) next[rk].delete(k); else next[rk].add(k);
    setPerm(next);
    run(() => rolesSave(owner, { pro: [...next.pro], skl: [...next.skl] }));
  };
  const av = (n: string) => <span className="av">{(n[0] ?? '?').toUpperCase()}</span>;
  return (
    <Modal title="Zaměstnanci a role" wide onClose={onClose} foot={<button type="button" className="btn p" onClick={onClose}>Hotovo</button>}>
      <Seg value={tab} onChange={setTab} style={{ width: 340, marginBottom: 0 }} options={[['p', `Lidé (${team.members.length + 1})`], ['r', 'Co smí role']]} />
      {tab === 'p' ? (
        <>
          <div className="sgrp">
            <div className="sgh">Tým</div>
            <div className="srow str2">
              {av(ownerName)}<div><b>{ownerName} <span className="sown">majitel</span></b><small>{isOwner ? 'vy' : ''}</small></div>
              <div className="seg" style={{ width: 300 }}>{ROLES.map(([k, t]) => <button key={k} type="button" className={k === 'ved' ? 'on' : ''} disabled>{t}</button>)}</div>
            </div>
            {team.members.map((w) => (
              <div key={w.id} className="srow str2">
                {av(w.name)}
                <div><b>{w.name}{w.id === me ? ' (vy)' : ''}</b><small>{w.email ?? ''}</small></div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div className="seg" style={{ width: 300 }}>
                    {ROLES.map(([k, t]) => <button key={k} type="button" className={w.role === k ? 'on' : ''} disabled={pending || w.id === me}
                      onClick={() => run(() => staffRole(owner, w.id, k), `${w.name}: ${t}`)}>{t}</button>)}
                  </div>
                  {w.id === me ? null : confirm === w.id
                    ? <button type="button" className="btn sm g d" disabled={pending} onClick={() => { setConfirm(null); run(() => staffRemove(owner, w.id), `${w.name} už není v týmu`); }}>Opravdu odebrat</button>
                    : <button type="button" className="btn sm g" title="Odebrat z týmu" onClick={() => setConfirm(w.id)}>{Ico.x}</button>}
                </div>
              </div>
            ))}
          </div>
          <div className="sgrp">
            <div className="sgh">Pozvat</div>
            <form className="srow" onSubmit={(e) => { e.preventDefault(); run(() => staffAdd(owner, email, 'pro'), 'Přidáno do týmu jako Prodavač. Roli změníte výše.'); setEmail(''); }}>
              <div className="inp" style={{ flex: 1 }}><input type="email" required value={email} maxLength={200} style={{ font: '500 14px var(--fs)' }} placeholder="E-mail účtu V4cards nového zaměstnance" onChange={(e) => setEmail(e.target.value)} /></div>
              <button type="submit" className="btn" disabled={pending || !email.trim()}>Pozvat</button>
            </form>
            <small style={{ color: 'var(--ink-muted)', fontSize: 12, padding: '0 4px' }}>Člověk se přihlašuje svým účtem V4cards. Sklad obchodu pak najde v menu Sklad.</small>
          </div>
        </>
      ) : (
        <>
          <div className="pmx2h"><span>Vedoucí může vždy všechno. Změna se projeví hned.</span><b>Prodavač</b><b>Skladník</b></div>
          {PGROUPS.map(([g, ks]) => (
            <div key={g} className="sgrp">
              <div className="sgh">{g}</div>
              {ks.map((k) => (
                <div key={k} className="srow pmx2"><b>{PT[k]}</b>
                  {(['pro', 'skl'] as const).map((rk) => <span key={rk}><button type="button" className={`tg${perm[rk].has(k) ? ' on' : ''}`} disabled={pending} aria-label={`${rk}: ${PT[k]}`} onClick={() => flip(rk, k)} /></span>)}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}

/** Automatické ceny: za kolik prodávat, pojistky, výjimky, náhled na dnešní noc. */
function RulesModal({ owner, auto, places, games, onClose, toast }: {
  owner: string; auto: { rules: AutoRules; changes: AutoChange[] }; places: string[]; games: string[]; onClose: () => void; toast: Toast;
}) {
  const R = auto.rules;
  const [on, setOn] = useState(R.enabled);
  const [mode, setMode] = useState(R.mode);
  const [pct, setPct] = useState(String(R.pct));
  const [floor, setFloor] = useState(String(R.floorPct));
  const [cap, setCap] = useState(String(R.capPct));
  const [exL, setExL] = useState<string[]>(R.exclLocations);
  const [exG, setExG] = useState<string[]>(R.exclGames);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const p = Number(pct.replace(',', '.')) || 0;
  const ex100 = Math.round(100 * (mode === 'under' ? 1 - p / 100 : mode === 'over' ? 1 + p / 100 : 1));
  const rows = auto.changes;
  const dn = rows.filter((x) => x.next < x.old).length, up = rows.length - dn;
  const save = () => start(async () => {
    const r = await autopriceSave(owner, { enabled: on, mode, pct: p, floorPct: Number(floor) || 0, capPct: Number(cap) || 15, exclLocations: exL, exclGames: exG });
    if (r.error) { toast(r.error, true); return; }
    toast(r.text ?? 'Uloženo');
    router.refresh();
    onClose();
  });
  return (
    <Modal title="Automatické ceny" wide onClose={onClose} foot={<>
      <span className="note">Změny v noci uvidíte v Historii a každou jde vrátit.</span>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
      <button type="button" className="btn p" disabled={pending} onClick={save}>Uložit</button>
    </>}>
      <div className="autoh">
        <div><b>Hlídat ceny automaticky</b><small>Každou noc ve 3:00 nastavíme ceny karet na prodej podle pravidel níže. Ráno uvidíte změny v Historii a každou jde vrátit.</small></div>
        <button type="button" className={`tg${on ? ' on' : ''}`} aria-label="Hlídat ceny automaticky" onClick={() => setOn(!on)} />
      </div>
      <div className="arcard">
        <div className="arh"><span className="arn">1</span><div><b>Za kolik prodávat</b><small>Platí pro všechny karty na prodej.</small></div></div>
        <div className="arrow1">
          <Seg className="arseg" value={mode} onChange={setMode} options={[['under', 'Pod cenou trhu'], ['market', 'Tržní cena'], ['over', 'Nad cenou trhu']]} />
          {mode !== 'market' ? <label className="inp arpct"><span>o</span><input value={pct} inputMode="decimal" onChange={(e) => setPct(e.target.value.replace(/[^\d,.]/g, ''))} /><em>%</em></label> : null}
        </div>
        <p className="arex">Příklad: karta, která má na trhu cenu <b>100 Kč</b>, bude u vás za <b className="acc">{ex100} Kč</b>.</p>
      </div>
      <div className="arcard">
        <div className="arh"><span className="arn">2</span><div><b>Pojistky</b><small>Aby se cena nikdy nepohnula tam, kam nechcete.</small></div></div>
        <div className="arline"><span>Nejnižší cena<small className="arhint">Nákupní = za kolik jste kartu koupili (v detailu karty). Karty bez nákupní ceny tahle pojistka nechrání, hlídá je jen největší změna za noc.</small></span>
          <label className="inp arsm arw"><span>nákupní +</span><input value={floor} inputMode="numeric" onChange={(e) => setFloor(e.target.value.replace(/\D/g, ''))} /><em>%</em></label></div>
        <div className="arline"><span>Největší změna za noc<small className="arhint">Ceny se přepočítají jednou denně ve 3:00. O kolik nejvýš se cena karty může při tom jednom přepočtu posunout nahoru nebo dolů.</small></span>
          <label className="inp arsm"><input value={cap} inputMode="numeric" onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} /><em>%</em></label></div>
      </div>
      <div className="arcard">
        <div className="arh"><span className="arn">3</span><div><b>Výjimky</b><small>Co se má vůbec neměnit.</small></div></div>
        <div className="arline"><span>Neměnit vůbec</span>
          <span className="exl">
            {exG.map((x) => <span key={`g${x}`} className="fpill">{x}<button type="button" className="xx" onClick={() => setExG(exG.filter((y) => y !== x))}>×</button></span>)}
            {exL.map((x) => <span key={`l${x}`} className="fpill">{x}<button type="button" className="xx" onClick={() => setExL(exL.filter((y) => y !== x))}>×</button></span>)}
            <span className="fpill lockp">Zamčené ceny</span>
          </span>
        </div>
        {adding ? (
          <div className="arline"><span>Přidat výjimku</span>
            <span className="exl">
              {games.filter((g) => !exG.includes(g)).map((g) => <button key={g} type="button" className="chip" onClick={() => { setExG([...exG, g]); setAdding(false); }}>{g}</button>)}
              {places.filter((l) => !exL.includes(l)).map((l) => <button key={l} type="button" className="chip" onClick={() => { setExL([...exL, l]); setAdding(false); }}>{l}</button>)}
            </span>
          </div>
        ) : null}
        <button type="button" className="btn sm g arplus" onClick={() => setAdding(!adding)}>+ Přidat výjimku pro hru nebo místo</button>
      </div>
      <div className="arcard">
        <div className="arh"><span className="arn">4</span><div><b>Co se stane dnes v noci</b><small>{R.lastRun ? 'Náhled podle uložených pravidel.' : 'Náhled se ukáže po prvním uložení pravidel.'}</small></div></div>
        <div className="arsum"><span><b>{rows.length}</b> {rows.length === 1 ? 'karta změní' : rows.length < 5 && rows.length ? 'karty změní' : 'karet změní'} cenu</span><span className="dn"><b>{dn}</b> zlevní</span><span className="up"><b>{up}</b> zdraží</span></div>
        <div className="arprev">
          {rows.slice(0, 5).map((x) => {
            const d = Math.round((x.next / x.old - 1) * 100);
            return (
              <div key={x.id}><span className="an">{x.name}<small>{x.set} · {x.condition}</small></span><span className="ao">{kc(x.old)}</span><span className="aa">→</span>
                <span className={`anw ${x.next < x.old ? 'dn' : 'up'}`}>{kc(x.next)}<small>{d > 0 ? '+' : ''}{d} %</small></span><span className="aw">{x.reason}</span></div>
            );
          })}
          {rows.length > 5 ? <div className="armore">a dalších {plA(rows.length - 5)}</div> : null}
        </div>
      </div>
    </Modal>
  );
}

