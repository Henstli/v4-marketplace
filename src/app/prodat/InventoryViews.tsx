'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDateTime } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import type { InventoryData, Inventory, Place, PlanTask } from './inventory';
import type { Perm } from './team';
import {
  groupSave, inventoryCancel, inventoryDecide, inventorySave, inventoryStart, placeSave, planApply, planSet, shiftToggle, teamSettings, type Res,
} from './team-actions';
import { Ico, langCode, Modal, nf, pl1, plw, Seg } from './sk';

export type InvView = 'mista' | 'pocitani' | 'kontrola' | 'historie' | 'plan' | 'smeny';

interface Props {
  data: InventoryData;
  view: InvView;
  invId?: number;
  owner: string;
  me: string;
  perms: Perm[];
  /** '' nebo 'obchod=…' (sklad obchodu, kde je přihlášený v týmu) */
  q: string;
}

const DAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const DAYS_FULL = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'];
const dLab = (d: string) => `${Number(d.slice(8, 10))}. ${Number(d.slice(5, 7))}.`;
const minutes = (s: number | null) => (s == null ? '–' : s < 60 ? '< 1 min' : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
const mist = (n: number) => plw(n, ['místo', 'místa', 'míst']);
const ROLE: Record<string, string> = { ved: 'Vedoucí', pro: 'Prodavač', skl: 'Skladník' };

function addDays(day: string, n: number) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function href(q: string, params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams({ zalozka: 'inventura' });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  if (q) sp.set('obchod', q.slice('obchod='.length));
  return `/prodat?${sp.toString()}`;
}

/** Spuštění akce s hlášením v toastu a obnovením stránky. */
function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<Res>, after?: (r: Res) => void) => start(async () => {
    const r = await fn();
    setMsg(r.error ? { ok: false, t: r.error } : r.text ? { ok: true, t: r.text } : null);
    if (!r.error) { after?.(r); router.refresh(); }
  });
  const toast = msg ? <div className={`toast${msg.ok ? '' : ' err'}`} role="status">{msg.t}</div> : null;
  return { pending, run, toast };
}

const checkLabel = (pl: Place) => {
  if (pl.counting) return 'Rozdělaná inventura';
  if (!pl.lastChecked) return 'Ještě nekontrolováno';
  const d = Math.max(0, pl.overdue + pl.every);
  return d === 0 ? 'Kontrola dnes' : d === 1 ? 'Kontrola včera' : `Kontrola před ${d} dny`;
};
const isOld = (pl: Place) => !!pl.counting || !pl.lastChecked || pl.overdue > 0;

export function InventoryViews(p: Props) {
  const has = (x: Perm) => p.perms.includes(x);
  const [mode, setMode] = useState<'g' | 'a'>('g');
  const [modal, setModal] = useState<null | { k: 'group'; name?: string } | { k: 'places' } | { k: 'plan'; day?: string; user?: string; place?: string } | { k: 'shifts' }>(p.view === 'smeny' ? { k: 'shifts' } : null);
  if (p.view === 'pocitani') return <Count {...p} />;
  const tab = p.view === 'plan' || p.view === 'smeny' ? 'plan' : p.view === 'historie' || p.view === 'kontrola' ? 'historie' : 'mista';
  const canPlan = has('plan');
  const showPlan = canPlan || has('inv');
  const tabs: [string, string][] = [['mista', 'Místa'], ...(showPlan ? [['plan', 'Plán'] as [string, string]] : []), ['historie', 'Historie']];
  return (
    <>
      {tab === 'mista' ? <MyTasks {...p} /> : null}
      <div className="ibar">
        <div className="seg" style={{ width: tabs.length * 110 }}>
          {tabs.map(([k, t]) => <Link key={k} className={tab === k ? 'on' : ''} href={href(p.q, { pohled: k === 'mista' ? undefined : k })}>{t}</Link>)}
        </div>
        {tab === 'mista' ? (
          <div className="seg sub" style={{ width: 260 }}>
            {([['g', 'Podle skupin'], ['a', 'Všechna místa']] as const).map(([k, t]) => <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{t}</button>)}
          </div>
        ) : null}
        {tab === 'mista' && canPlan ? (
          <>
            <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => setModal({ k: 'places' })}>Upravit místa</button>
            <button type="button" className="btn" onClick={() => setModal({ k: 'group' })}>+ Nová skupina</button>
          </>
        ) : null}
      </div>
      {tab === 'mista' ? <Places {...p} mode={mode} onGroup={(name) => setModal({ k: 'group', name })} onPlan={(place) => setModal({ k: 'plan', place })} /> : null}
      {tab === 'plan' ? <Plan {...p} onPlan={(day, user, place) => setModal({ k: 'plan', day, user, place })} onShifts={() => setModal({ k: 'shifts' })} /> : null}
      {tab === 'historie' ? <History {...p} pendingFirst={p.view === 'kontrola'} /> : null}
      {modal?.k === 'group' ? <GroupModal data={p.data} owner={p.owner} name={modal.name} onClose={() => setModal(null)} /> : null}
      {modal?.k === 'places' ? <PlacesModal data={p.data} owner={p.owner} onClose={() => setModal(null)} /> : null}
      {modal?.k === 'plan' ? <PlanModal data={p.data} owner={p.owner} me={p.me} canPlan={canPlan} init={modal} onClose={() => setModal(null)} /> : null}
      {modal?.k === 'shifts' ? <ShiftsModal {...p} onClose={() => setModal(null)} /> : null}
    </>
  );
}

// ===== Moje inventury =====

function MyTasks({ data, owner, me, q, perms }: Props) {
  const router = useRouter();
  const { pending, run, toast } = useRun();
  const today = data.week.today;
  const T = data.plan.filter((t) => t.userId === me && t.day === today);
  const mine = data.places.filter((pl) => pl.counting?.mine && !T.some((t) => t.places.includes(pl.name)));
  if (!perms.includes('inv') || (!T.length && !mine.length)) return null;
  const go = (pl: Place) => (pl.counting?.mine
    ? router.push(href(q, { pohled: 'pocitani', inventura: pl.counting.id }))
    : run(() => inventoryStart(owner, pl.name), (r) => router.push(href(q, { pohled: 'pocitani', inventura: r.id }))));
  const task = (name: string, places: string[], key: string) => {
    const L = places.map((n) => data.places.find((x) => x.name === n)).filter(Boolean) as Place[];
    const done = L.filter((x) => x.lastChecked && x.lastChecked.slice(0, 10) >= today).length;
    const next = L.find((x) => x.counting?.mine) ?? L.find((x) => !(x.lastChecked && x.lastChecked.slice(0, 10) >= today) && !x.counting);
    return (
      <div key={key} className="mytc today">
        <div>
          <b>{name}</b>
          <small><span className="td">Dnes</span> · {mist(L.length)}</small>
          {L.length > 1 ? <span className="ipp"><i style={{ width: `${(done / L.length) * 100}%` }} /></span> : null}
        </div>
        {next ? <button type="button" className="btn sm p" disabled={pending} onClick={() => go(next)}>{next.counting?.mine || done ? 'Pokračovat' : 'Začít'}</button> : <span className="st ok">Hotovo</span>}
      </div>
    );
  };
  return (
    <div className="mytk">
      {toast}
      <div className="mytkh"><b>Moje inventury</b><small>úkoly na dnešek, po dokončení zmizí</small></div>
      <div className="mytkl">
        {T.map((t) => task(t.places.length <= 2 ? t.places.join(', ') : `${t.places.slice(0, 2).join(', ')} +${t.places.length - 2}`, t.places, `${t.day}${t.userId}`))}
        {mine.map((pl) => task(pl.name, [pl.name], pl.name))}
      </div>
    </div>
  );
}

// ===== Místa =====

function Places({ data, owner, me, perms, q, mode, onGroup, onPlan }: Props & { mode: 'g' | 'a'; onGroup: (name: string) => void; onPlan: (place: string) => void }) {
  const router = useRouter();
  const { pending, run, toast } = useRun();
  const canPlan = perms.includes('plan');
  const canInv = perms.includes('inv');
  const today = data.week.today;
  const nameOf = (id: string) => data.people.find((x) => x.id === id)?.name ?? '';
  const next = (pl: Place) => data.plan.filter((t) => t.day >= today && t.places.includes(pl.name)).sort((a, b) => a.day.localeCompare(b.day))[0];

  const card = (pl: Place) => {
    const tdy = pl.today.length > 0 && (canPlan || pl.today.includes(me));
    const nx = next(pl);
    const go = () => run(() => inventoryStart(owner, pl.name), (r) => router.push(href(q, { pohled: 'pocitani', inventura: r.id })));
    return (
      <div key={pl.name} className={`locc${tdy ? ' tdy' : ''}`}>
        {pl.counting ? <div className="tdyb run"><i className="pulse" />{pl.counting.mine ? 'Rozdělaná' : `${pl.counting.user} právě počítá`}</div>
          : tdy ? <div className="tdyb">{pl.overdue > 0 ? 'Po termínu' : 'Dnes na řadě'}{canPlan ? ` · ${pl.today.map(nameOf).join(', ')}` : ''}</div> : null}
        <div className="lh"><b>{pl.name}</b><span className={isOld(pl) ? 'old' : ''}>{checkLabel(pl)}</span></div>
        <div className="lim">{pl.images.map((im, i) => <img key={i} src={thumbUrl(im)} alt="" />)}</div>
        <small>{pl1(pl.rows)} · {nf(pl.pcs)} ks</small>
        <i className="lsp" />
        {nx ? <div className={`ipon${nx.day === today ? ' tod' : ''}`}><span className="av">{nameOf(nx.userId)[0]}</span>{nameOf(nx.userId)} · {nx.day === today ? 'dnes' : `${DAYS[(new Date(nx.day + 'T12:00:00Z').getUTCDay() + 6) % 7].toLowerCase()} ${dLab(nx.day)}`}</div>
          : canPlan ? <button type="button" className="ipon none" onClick={() => onPlan(pl.name)}>+ Naplánovat</button> : null}
        {pl.counting ? (pl.counting.mine ? <Link className="btn sm p" href={href(q, { pohled: 'pocitani', inventura: pl.counting.id })}>Pokračovat</Link> : null)
          : canInv ? <button type="button" className={`btn sm${tdy ? ' p' : ''}`} disabled={pending || !pl.rows} onClick={go}>Začít inventuru</button> : null}
      </div>
    );
  };

  if (!data.places.length) {
    return <div className="tbl"><div className="none">Zatím žádná místa. Místo je umístění karty, třeba krabice nebo šuplík. Nastavíte ho v detailu karty nebo hromadně v tabulce a místo se tu objeví.</div></div>;
  }
  const used = new Set(data.places.map((x) => x.group).filter(Boolean) as string[]);
  const groups = [...data.groups.map((g) => g.name), ...[...used].filter((g) => !data.groups.some((x) => x.name === g))];
  const grp = (name: string, L: Place[], g: { blind: boolean; person: string | null } | null) => {
    if (!L.length && !g) return null;
    const pcs = L.reduce((s, x) => s + x.pcs, 0);
    const od = L.filter(isOld).length;
    const td = L.filter((x) => x.today.length && (canPlan || x.today.includes(me))).length;
    const every = [...new Set(L.map((x) => x.every))];
    return (
      <div key={name} className="igrp">
        <div className="igh">
          <div>
            <b>{name}{g ? <span className="igmeta">{every.length === 1 ? `kontrola každých ${every[0]} dní` : 'různé termíny'}{g.blind ? ' · slepá inventura' : ''}{g.person ? <> · obvykle <span className="av">{nameOf(g.person)[0]}</span>{nameOf(g.person)}</> : null}</span> : null}</b>
            <small>{mist(L.length)} · {nf(pcs)} ks{od ? <> · <span className="old">{od} {od === 1 ? 'čeká' : 'čekají'} na kontrolu</span></> : L.length ? ' · vše zkontrolováno' : ''}{td ? <> · <span className="tdyc">{td} {canPlan ? 'dnes naplánováno' : 'dnes na vás'}</span></> : null}</small>
          </div>
          <span className="igact">{g && canPlan ? <button type="button" className="btn sm g" onClick={() => onGroup(name)}>Upravit</button> : null}</span>
        </div>
        {L.length ? <div className="locs">{L.map(card)}</div> : <small className="wsm">Ve skupině zatím nejsou žádná místa. Přidáte je přes Upravit.</small>}
      </div>
    );
  };
  return (
    <>
      {toast}
      {mode === 'a' ? <div className="locs">{data.places.map(card)}</div> : (
        <>
          {groups.map((n) => {
            const g = data.groups.find((x) => x.name === n) ?? { name: n, blind: false, person: null };
            return grp(n, data.places.filter((x) => x.group === n), g);
          })}
          {grp(groups.length ? 'Bez skupiny' : 'Všechna místa', data.places.filter((x) => !x.group || !groups.includes(x.group)), null)}
        </>
      )}
    </>
  );
}

function GroupModal({ data, owner, name, onClose }: { data: InventoryData; owner: string; name?: string; onClose: () => void }) {
  const g = data.groups.find((x) => x.name === name);
  const [n, setN] = useState(name ?? '');
  const [blind, setBlind] = useState(g?.blind ?? false);
  const [person, setPerson] = useState(g?.person ?? '');
  const inG = data.places.filter((x) => name && x.group === name);
  const [every, setEvery] = useState(String(inG[0]?.every ?? 30));
  const [sel, setSel] = useState<Set<string>>(new Set(inG.map((x) => x.name)));
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = () => start(async () => {
    const nm = n.trim();
    if (!nm) { setErr('Napište název skupiny.'); return; }
    const r = await groupSave(owner, nm, blind, person || null);
    if (r.error) { setErr(r.error); return; }
    const ev = Math.max(1, Math.min(365, Number(every) || 30));
    for (const pl of data.places) {
      const want = sel.has(pl.name);
      const was = pl.group === (name ?? nm);
      if (want && (!was || pl.every !== ev || pl.group !== nm)) {
        const x = await placeSave(owner, pl.name, nm, ev);
        if (x.error) { setErr(x.error); return; }
      } else if (!want && was) {
        const x = await placeSave(owner, pl.name, '', pl.every);
        if (x.error) { setErr(x.error); return; }
      }
    }
    router.refresh();
    onClose();
  });
  return (
    <Modal title={name ? `Upravit skupinu ${name}` : 'Nová skupina míst'} onClose={onClose} foot={<>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
      <button type="button" className="btn p" disabled={pending} onClick={save}>Uložit</button>
    </>}>
      <div className="grid2">
        <div className="f"><label>Název</label><div className="inp"><input value={n} disabled={!!name} maxLength={40} placeholder="např. Vitrína" onChange={(e) => setN(e.target.value)} /></div></div>
        <div className="f"><label>Kontrolovat každých</label><div className="inp"><input value={every} inputMode="numeric" onChange={(e) => setEvery(e.target.value.replace(/\D/g, ''))} /><em>dní</em></div></div>
      </div>
      <div className="grid2">
        <div className="f"><label>Slepá inventura</label><Seg value={blind ? 'a' : 'n'} onChange={(v) => setBlind(v === 'a')} options={[['n', 'Ne'], ['a', 'Ano']]} /><small className="wsm">Kdo počítá, neuvidí, kolik kusů má podle skladu být.</small></div>
        <div className="f"><label>Obvykle počítá</label>
          <div className="inp"><select value={person} onChange={(e) => setPerson(e.target.value)} style={{ background: 'none', border: 0, flex: 1, font: '500 14px var(--fs)' }}>
            <option value="">Kdokoli</option>
            {data.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></div>
        </div>
      </div>
      <div className="f">
        <label>Místa ve skupině</label>
        <div className="olist" style={{ maxHeight: 260, overflow: 'auto' }}>
          {data.places.map((pl) => (
            <label key={pl.name} className="drow" style={{ cursor: 'pointer' }}>
              <span className={`cb${sel.has(pl.name) ? ' on' : ''}`} onClick={(e) => { e.preventDefault(); setSel((s) => { const x = new Set(s); if (x.has(pl.name)) x.delete(pl.name); else x.add(pl.name); return x; }); }} />
              <span style={{ flex: 1 }}><b>{pl.name}</b> <small className="wsm">{pl1(pl.rows)} · {nf(pl.pcs)} ks{pl.group && pl.group !== name ? ` · teď ve skupině ${pl.group}` : ''}</small></span>
            </label>
          ))}
        </div>
      </div>
      {err ? <small style={{ color: 'var(--down)' }}>{err}</small> : null}
    </Modal>
  );
}

function PlacesModal({ data, owner, onClose }: { data: InventoryData; owner: string; onClose: () => void }) {
  const groups = [...new Set([...data.groups.map((g) => g.name), ...data.places.map((x) => x.group).filter(Boolean) as string[]])];
  const [rows, setRows] = useState(() => data.places.map((x) => ({ name: x.name, group: x.group ?? '', every: String(x.every), isNew: false })));
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (i: number, k: 'name' | 'group' | 'every', v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = () => start(async () => {
    for (const r of rows) {
      const orig = data.places.find((x) => x.name === r.name);
      const ev = Math.max(1, Math.min(365, Number(r.every) || 30));
      if (!r.name.trim()) continue;
      if (orig && (orig.group ?? '') === r.group && orig.every === ev) continue;
      const x = await placeSave(owner, r.name.trim(), r.group.trim(), ev);
      if (x.error) { setErr(x.error); return; }
    }
    router.refresh();
    onClose();
  });
  return (
    <Modal title="Upravit místa" wide onClose={onClose} foot={<>
      <button type="button" className="btn" style={{ marginRight: 'auto' }} onClick={() => setRows((r) => [...r, { name: '', group: '', every: '30', isNew: true }])}>+ Přidat místo</button>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
      <button type="button" className="btn p" disabled={pending} onClick={save}>Uložit</button>
    </>}>
      <p className="ixlead">Místo je umístění karty, třeba krabice nebo šuplík. Karty na místo dáte v detailu karty nebo hromadně v tabulce.</p>
      <datalist id="sk-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      <div className="olist">
        <div className="drow oth" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 200px 150px 90px', gap: 12 }}><span>Místo</span><span>Skupina</span><span>Kontrola každých</span><span>Karet</span></div>
        {rows.map((r, i) => {
          const pl = data.places.find((x) => x.name === r.name && !r.isNew);
          return (
            <div key={i} className="drow" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 200px 150px 90px', gap: 12 }}>
              {r.isNew ? <div className="inp"><input autoFocus value={r.name} maxLength={60} placeholder="např. Krabice A1" onChange={(e) => set(i, 'name', e.target.value)} /></div> : <b>{r.name}</b>}
              <div className="inp"><input value={r.group} list="sk-groups" maxLength={40} placeholder="Bez skupiny" onChange={(e) => set(i, 'group', e.target.value)} /></div>
              <div className="inp"><input value={r.every} inputMode="numeric" onChange={(e) => set(i, 'every', e.target.value.replace(/\D/g, ''))} /><em>dní</em></div>
              <span className="mono">{pl ? nf(pl.rows) : '–'}</span>
            </div>
          );
        })}
      </div>
      {err ? <small style={{ color: 'var(--down)' }}>{err}</small> : null}
    </Modal>
  );
}

// ===== Počítání =====

function Count({ data, invId, q }: Props) {
  const router = useRouter();
  const inv = data.inventories.find((i) => i.id === invId);
  const lines = inv?.lines ?? [];
  const [res, setRes] = useState<Record<string, number>>(() => Object.fromEntries(lines.filter((l) => l.counted != null).map((l) => [l.listing_id, l.counted!])));
  const [idx, setIdx] = useState(() => { const k = lines.findIndex((l) => l.counted == null); return k < 0 ? lines.length : k; });
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [cur, setCur] = useState<string | null>(null);
  const [note, setNote] = useState(inv?.note ?? '');
  const { pending, run, toast } = useRun();
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { inp.current?.focus(); inp.current?.select(); }, [idx]);

  if (!inv) return <div className="tbl"><div className="none">Inventura nenalezena. <Link href={href(q, {})}>Zpět na místa</Link></div></div>;
  if (inv.status !== 'counting') return <div className="tbl"><div className="none">Inventura místa {inv.place} už neběží. <Link href={href(q, { pohled: 'historie' })}>Historie inventur</Link></div></div>;
  const BL = inv.blind;
  const doneN = lines.filter((l) => res[l.listing_id] != null).length;
  const nextIdx = (from: number, r = res, sk = skip) => {
    for (let k = from + 1; k < lines.length; k++) if (r[lines[k].listing_id] == null && !sk.has(lines[k].listing_id)) return k;
    for (let k = 0; k < lines.length; k++) if (r[lines[k].listing_id] == null && !sk.has(lines[k].listing_id)) return k;
    return lines.length;
  };
  const jump = (k: number) => { setCur(null); setIdx(k); };
  const head = (
    <div className="invh">
      <Link className="btn sm g" href={href(q, {})} style={{ paddingLeft: 0 }}>← Místa</Link>
      <b>Inventura {inv.place}</b>
      {BL ? <span className="iqb bl">Slepá</span> : null}
      <span className="mono">{doneN} / {lines.length} hotovo</span>
      <div className="iprog"><i style={{ width: `${lines.length ? (doneN / lines.length) * 100 : 100}%` }} /></div>
      <button type="button" className="btn sm" disabled={pending} onClick={() => run(() => inventorySave(inv.id, res, false, note), () => router.push(href(q, {})))}>Uložit a odejít</button>
      <button type="button" className="btn sm" disabled={pending} onClick={() => run(() => inventoryCancel(inv.id), () => router.push(href(q, {})))}>Zrušit</button>
    </div>
  );

  if (idx >= lines.length) {
    const diff = lines.filter((l) => res[l.listing_id] != null && res[l.listing_id] !== l.expected);
    const ok = lines.filter((l) => res[l.listing_id] === l.expected);
    const left = lines.filter((l) => res[l.listing_id] == null);
    const mi = diff.filter((l) => res[l.listing_id] < l.expected).reduce((s, l) => s + l.expected - res[l.listing_id], 0);
    const pl = diff.filter((l) => res[l.listing_id] > l.expected).reduce((s, l) => s + res[l.listing_id] - l.expected, 0);
    return (
      <>
        {toast}
        {head}
        <div className="invdone">
          <div className={`ok-ic${left.length ? ' warn' : ''}`}>{left.length ? '!' : Ico.sale}</div>
          <h2>{left.length ? `Zbývá spočítat ${pl1(left.length)}` : `Zkontrolujte a potvrďte inventuru ${inv.place}`}</h2>
          {left.length ? <div className="iwarn"><b>Nezkontrolováno {pl1(left.length)}.</b> Inventuru jde dokončit, až budou spočítané všechny karty. Kartu, která chybí, zapište jako 0.</div>
            : <p className="rvl">Všechny karty máte projité. Kdyby se něco nepočítalo, klikněte na kartu a opravte ji. Nic se nezapíše, dokud nedáte Hotovo.</p>}
          {BL ? <p>Slepá inventura: spočítáno <b>{doneN}</b> z {lines.length} karet. Rozdíly proti skladu uvidí až vedoucí po dokončení.</p>
            : <p><b>{ok.length}</b> sedí · <b className={diff.length ? 'w' : ''}>{diff.length}</b> {diff.length === 1 ? 'rozdíl' : 'rozdíly'}</p>}
          {!BL && diff.length ? (
            <div className="dsum">
              <div><small>Chybí</small><b className={`mono${mi ? ' neg' : ''}`}>{mi} ks</b></div>
              <div><small>Přebývá</small><b className={`mono${pl ? ' acc' : ''}`}>{pl} ks</b></div>
              <div><small>Celkem</small><b className="mono">{pl - mi >= 0 ? '+' : '−'}{Math.abs(pl - mi)} ks</b></div>
            </div>
          ) : null}
          <div className="tbl rvt" style={{ textAlign: 'left' }}>
            {lines.map((l, k) => {
              const r = res[l.listing_id];
              return (
                <button key={l.listing_id} type="button" className="drow rvr" onClick={() => jump(k)}>
                  {l.image ? <img src={thumbUrl(l.image)} alt="" /> : <img alt="" />}
                  <span><b>{l.name}</b><small className="mono">{l.set} · {l.cond} · {langCode(l.lang)}</small></span>
                  {r == null ? <em className={`st${skip.has(l.listing_id) ? ' skp' : ''}`}>{skip.has(l.listing_id) ? 'Přeskočeno' : 'Nezkontrolováno'}</em>
                    : BL ? <em className="st">{r} ks</em>
                      : r === l.expected ? <em className="st ok">Sedí · {r} ks</em>
                        : <span className="mono">{l.expected} → <b className={r < l.expected ? 'dn' : 'up'}>{r}</b></span>}
                  <span className="rve">Opravit</span>
                </button>
              );
            })}
          </div>
          <div className="f" style={{ textAlign: 'left', marginTop: 14 }}>
            <label>Poznámka pro vedoucího (nepovinná)</label>
            <div className="inp"><input value={note} maxLength={300} placeholder="např. dvě karty byly v jiné krabici" onChange={(e) => setNote(e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
            <button type="button" className="btn" onClick={() => jump(left.length ? lines.indexOf(left[0]) : lines.length - 1)}>← Zpět ke kartám</button>
            <button type="button" className="btn p" disabled={pending || left.length > 0} onClick={() => run(() => inventorySave(inv.id, res, true, note), () => router.push(href(q, { pohled: 'historie' })))}>
              {diff.length && !BL ? 'Hotovo, zapsat rozdíly do skladu' : 'Hotovo, potvrdit'}
            </button>
          </div>
        </div>
      </>
    );
  }

  const i = lines[idx];
  const v = cur ?? String(res[i.listing_id] ?? (BL ? 0 : i.expected));
  const n = Math.max(0, parseInt(v, 10) || 0);
  const save = () => {
    const r = { ...res, [i.listing_id]: n };
    const sk = new Set(skip); sk.delete(i.listing_id);
    setRes(r); setSkip(sk); setCur(null); setIdx(nextIdx(idx, r, sk));
  };
  const doSkip = () => { const sk = new Set(skip).add(i.listing_id); setSkip(sk); setCur(null); setIdx(nextIdx(idx, res, sk)); };
  return (
    <>
      {toast}
      {head}
      <div className="invg">
        <div className="invc">
          {i.image ? <img src={thumbUrl(i.image)} alt="" /> : <img alt="" />}
          <div className="invi">
            <h2>{i.name}</h2>
            <p className="mono">{i.set}</p>
            <p><span className={`cond ${i.cond}`}>{i.cond}</span> <span className="lang">{langCode(i.lang)}</span></p>
            <div className="exp">{BL ? 'Slepá inventura: spočítejte kusy, počet podle skladu se neukazuje' : <>Podle skladu <b>{i.expected} ks</b></>}</div>
            <p className="lbl" style={{ margin: '18px 0 8px' }}>Napočítáno</p>
            <div className="bigstep">
              <button type="button" onClick={() => setCur(String(Math.max(0, n - 1)))}>−</button>
              <input ref={inp} className="pin" value={v} inputMode="numeric" onChange={(e) => setCur(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
              <button type="button" onClick={() => setCur(String(n + 1))}>+</button>
            </div>
            <div className="invbtn">
              <button type="button" className="btn p big" onClick={save}>{BL ? `Uložit ${n} ks` : n === i.expected ? 'Sedí' : `Uložit ${n > i.expected ? '+' : ''}${n - i.expected} ks`} <span className="kbd">Enter</span></button>
              <button type="button" className="btn g" onClick={doSkip}>Přeskočit</button>
            </div>
            {skip.has(i.listing_id) ? <p className="skpn">Tuhle kartu jste přeskočili. Najděte ji teď, nebo ji zapište jako 0.</p> : null}
          </div>
        </div>
        <div className="invl">
          {lines.map((x, k) => {
            const r = res[x.listing_id];
            return (
              <div key={x.listing_id} className={`ili${k === idx ? ' cur' : ''}`} title="Přejít na kartu" onClick={() => jump(k)}>
                {x.image ? <img src={thumbUrl(x.image)} alt="" /> : <img alt="" />}
                <span><b>{x.name}</b><small>{x.cond} · {langCode(x.lang)}</small></span>
                {r == null ? (k === idx ? <em className="st cur">Teď</em> : skip.has(x.listing_id) ? <em className="st skp">Přeskočeno</em> : <em className="st">Čeká</em>)
                  : BL ? <em className="st ok">{r} ks</em> : r === x.expected ? <em className="st ok">Sedí</em> : <em className="st df">{x.expected} → {r}</em>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ===== Historie =====

const diffSum = (inv: Inventory) => inv.lines.reduce((s, l) => s + (l.counted == null ? 0 : l.counted - l.expected), 0);
const diffLines = (inv: Inventory) => inv.lines.filter((l) => l.counted != null && l.counted !== l.expected);

function History({ data, me, perms, pendingFirst }: Props & { pendingFirst: boolean }) {
  const AL = perms.includes('diff');
  const [who, setWho] = useState('');
  const [pend, setPend] = useState(pendingFirst);
  const [open, setOpen] = useState<number | null>(null);
  const all = data.inventories.filter((i) => i.status !== 'counting');
  const H = all.filter((i) => (AL ? (!who || i.userId === who) : i.userId === me) && (!pend || i.status === 'review'));
  const nPend = all.filter((i) => i.status === 'review').length;
  const sel = all.find((i) => i.id === open);
  return (
    <div className="ihist">
      <div className="igh">
        <div><b>Historie inventur</b><small>{AL ? 'Každá inventura se uloží a nejde smazat. Vedoucí vidí všechny.' : 'Jen vaše inventury. Inventury ostatních vidí jen vedoucí.'}</small></div>
        {AL ? (
          <span className="igact">
            <div className="inp" style={{ width: 200, height: 34 }}>
              <select value={who} onChange={(e) => setWho(e.target.value)} style={{ background: 'none', border: 0, flex: 1, font: '500 13px var(--fs)' }} aria-label="Kdo">
                <option value="">Všichni zaměstnanci</option>
                {data.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
            <button type="button" className={`btn sm${pend ? ' p' : ''}`} onClick={() => setPend((x) => !x)}>Ke kontrole{nPend ? <> <span className="ihn">{nPend}</span></> : null}</button>
          </span>
        ) : null}
      </div>
      <div className="olist">
        <div className="hrw oth"><span>Datum</span><span>Místo</span><span>Kdo</span><span>Stav</span><span>Karet</span><span>Trvání</span><span>Poznámka</span><span>Rozdíly</span><span>Rozdíl v ks</span><span>Kontrola</span><span /></div>
        {H.length ? H.map((h) => {
          const D = diffLines(h), s = diffSum(h);
          const stb = h.status === 'cancelled' ? <span className="ist end">{h.note?.includes('přepočítat') ? 'Poslat přepočítat' : 'Zrušeno'}</span>
            : h.status === 'review' ? <span className="ist skip">Čeká na schválení</span> : <span className="ist ok">Dokončeno</span>;
          return (
            <div key={h.id} className={`hrw${h.status === 'cancelled' ? ' rend' : h.status === 'review' ? ' rskip' : ''}`} onClick={() => setOpen(h.id)}>
              <span className="mono">{formatDateTime(h.finishedAt ?? h.startedAt)}</span>
              <b>{h.place}</b>
              <span><span className="av">{h.user[0]}</span>{h.user}</span>
              {stb}
              <span className="mono">{h.lines.length}</span>
              <span className="mono">{minutes(h.seconds)}</span>
              <span>{h.note ? <span className="ist nx" title={h.note}>Poznámka</span> : <span className="dimc">–</span>}</span>
              <span>{D.length ? <b className="w">{D.length}</b> : h.status === 'cancelled' ? <span className="dimc">–</span> : <span className="st ok">Sedí</span>}</span>
              <b className={`mono${s < 0 ? ' neg' : s > 0 ? ' acc' : ''}`}>{s > 0 ? '+' : s < 0 ? '−' : ''}{Math.abs(s)} ks</b>
              <span>{h.status === 'review' ? <span className="ist skip">Ke kontrole</span> : h.decidedBy ? <small>{h.decidedBy}</small> : <span className="dimc">–</span>}</span>
              <span className="dact"><button type="button" className="btn sm g">Zobrazit</button></span>
            </div>
          );
        }) : <div className="hrw"><span style={{ color: 'var(--ink-muted)' }}>{pend ? 'Všechny inventury jsou zkontrolované.' : 'Zatím žádná inventura.'}</span></div>}
      </div>
      {sel ? <InvDetail inv={sel} canDecide={AL} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function InvDetail({ inv, canDecide, onClose }: { inv: Inventory; canDecide: boolean; onClose: () => void }) {
  const { pending, run, toast } = useRun();
  const D = diffLines(inv), s = diffSum(inv);
  return (
    <Modal title={`Inventura ${inv.place} · ${formatDateTime(inv.finishedAt ?? inv.startedAt)}`} wide onClose={onClose} foot={<>
      {canDecide && inv.status === 'review' ? <>
        <button type="button" className="btn" style={{ marginRight: 'auto' }} disabled={pending} onClick={() => run(() => inventoryDecide(inv.id, false), onClose)}>Poslat přepočítat</button>
        <button type="button" className="btn p" disabled={pending} onClick={() => run(() => inventoryDecide(inv.id, true), onClose)}>Zapsat rozdíly do skladu</button>
      </> : <button type="button" className="btn p" onClick={onClose}>Zavřít</button>}
    </>}>
      {toast}
      {inv.status === 'review' ? <div className="iwarn" style={{ textAlign: 'left', margin: 0 }}><b>Čeká na schválení.</b> Rozdíl je nad limitem, do skladu se zapíše, až ho schválí vedoucí.</div> : null}
      <div className="pvk">
        <div><small>Kdo</small><b>{inv.user}</b></div>
        <div><small>Karet zkontrolováno</small><b className="mono">{inv.lines.filter((l) => l.counted != null).length} / {inv.lines.length}</b></div>
        <div><small>Rozdíl</small><b className={`mono${s < 0 ? ' neg' : s > 0 ? ' acc' : ''}`}>{s > 0 ? '+' : s < 0 ? '−' : ''}{Math.abs(s)} ks</b></div>
      </div>
      {inv.note ? <p className="ixlead" style={{ margin: 0 }}>Poznámka: {inv.note}</p> : null}
      <div className="tbl rvt">
        {D.length ? D.map((l) => (
          <div key={l.listing_id} className="drow">
            {l.image ? <img src={thumbUrl(l.image)} alt="" /> : <img alt="" />}
            <span style={{ flex: 1 }}><b>{l.name}</b><small className="mono">{l.set} · {l.cond} · {langCode(l.lang)}</small></span>
            <span className="mono">{l.expected} → <b className={(l.counted ?? 0) < l.expected ? 'dn' : 'up'}>{l.counted}</b></span>
          </div>
        )) : <div className="none">{inv.status === 'cancelled' ? 'Inventura nebyla dokončena.' : 'Všechno sedělo.'}</div>}
      </div>
      {inv.decidedBy ? <small className="wsm">Schválil {inv.decidedBy}.</small> : null}
    </Modal>
  );
}

// ===== Plán =====

/** Návrh plánu: místa po termínu nebo s termínem do konce týdne rozdělí mezi lidi, kteří ten den nemají volno. */
function propose(data: InventoryData): PlanTask[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(data.week.from, i)).filter((d) => d >= data.week.today);
  const end = Math.round((new Date(data.week.to).getTime() - new Date(data.week.today).getTime()) / 86400000);
  const planned = new Set(data.plan.flatMap((t) => t.places));
  const todo = data.places.filter((p) => p.rows > 0 && !p.counting && !planned.has(p.name) && p.overdue >= -end).sort((a, b) => b.overdue - a.overdue);
  const off = new Set(data.shifts.map((s) => `${s.userId}|${s.day}`));
  const load = new Map<string, number>();
  for (const t of data.plan) load.set(`${t.userId}|${t.day}`, t.places.reduce((s, n) => s + (data.places.find((p) => p.name === n)?.pcs ?? 0), 0));
  const out = new Map<string, PlanTask>();
  for (const pl of todo) {
    const pref = data.groups.find((g) => g.name === pl.group)?.person;
    const people = pref && data.people.some((x) => x.id === pref) ? [pref] : data.people.map((x) => x.id);
    let best: { k: string; day: string; user: string; l: number } | null = null;
    for (const day of days) {
      for (const user of people) {
        const k = `${user}|${day}`;
        if (off.has(k)) continue;
        // Po termínu co nejdřív: každý další den přidá „zátěž“ jako 300 kusů.
        const l = (load.get(k) ?? 0) + (pl.overdue > 0 ? days.indexOf(day) * 300 : 0);
        if (!best || l < best.l) best = { k, day, user, l };
      }
    }
    if (!best) continue;
    load.set(best.k, (load.get(best.k) ?? 0) + pl.pcs);
    const t = out.get(best.k) ?? { day: best.day, userId: best.user, places: [...(data.plan.find((x) => x.day === best!.day && x.userId === best!.user)?.places ?? [])] };
    t.places.push(pl.name);
    out.set(best.k, t);
  }
  return [...out.values()];
}

function Plan({ data, owner, me, perms, q, onPlan, onShifts }: Props & { onPlan: (day?: string, user?: string, place?: string) => void; onShifts: () => void }) {
  const VED = perms.includes('plan');
  const { pending, run, toast } = useRun();
  const [draft, setDraft] = useState<PlanTask[] | null>(null);
  const w = data.week, today = w.today;
  const days = Array.from({ length: 7 }, (_, i) => addDays(w.from, i));
  const off = new Set(data.shifts.map((s) => `${s.userId}|${s.day}`));
  const people = VED ? data.people : data.people.filter((x) => x.id === me);
  const planned = new Set(data.plan.flatMap((t) => t.places));
  const need = data.places.filter((x) => x.rows > 0 && isOld(x) && !planned.has(x.name));
  const h = people.length <= 1 ? 330 : people.length === 2 ? 165 : 120;
  const st = (t: PlanTask) => {
    if (t.day > today) return 'plan';
    const done = t.places.every((n) => { const x = data.places.find((p) => p.name === n); return x?.lastChecked && x.lastChecked.slice(0, 10) >= t.day; });
    return done ? 'done' : t.day === today ? 'today' : 'late';
  };
  const label = (t: PlanTask) => (t.places.length <= 2 ? t.places.join(', ') : `${t.places.slice(0, 2).join(', ')} +${t.places.length - 2}`);
  return (
    <div className="iplan">
      {toast}
      <div className="iph">
        <div className="ipwk">
          <Link className="btn sm" href={href(q, { pohled: 'plan', tyden: w.offset - 1 })}>‹</Link>
          <b>{w.offset === 0 ? 'Tento týden' : w.offset === 1 ? 'Příští týden' : w.offset === -1 ? 'Minulý týden' : 'Týden'}</b>
          <span className="mono">{dLab(w.from)} – {dLab(w.to)}</span>
          <Link className="btn sm" href={href(q, { pohled: 'plan', tyden: w.offset + 1 })}>›</Link>
          {w.offset ? <Link className="btn sm iptoday" href={href(q, { pohled: 'plan' })}>← Zpět na tento týden</Link> : null}
        </div>
        {VED ? <button type="button" className="btn p sm" onClick={() => onPlan()}><span className="bplus">+</span>Naplánovat inventuru</button>
          : data.shiftMode === 'self' ? <button type="button" className="btn sm" onClick={onShifts}>Kdy můžu pracovat</button> : <span />}
      </div>
      {draft && VED ? (
        <div className="pbn">
          <div className="pbt"><b>Návrh plánu</b><span>{draft.length ? `${mist(draft.reduce((s, t) => s + t.places.length, 0))} po termínu nebo s termínem do konce týdne, rozdělená podle volna a počtu kusů. Návrh je v kalendáři čárkovaně. Nic se neuloží, dokud nedáte Použít.` : 'Tento týden není co navrhnout, všechna místa jsou v termínu nebo už v plánu.'}</span></div>
          <div className="pbb">
            <button type="button" className="btn sm" onClick={() => setDraft(null)}>Zrušit návrh</button>
            {draft.length ? <button type="button" className="btn sm p" disabled={pending} onClick={() => run(() => planApply(owner, draft), () => setDraft(null))}>Použít návrh</button> : null}
          </div>
        </div>
      ) : null}
      <div className={`ipwrap${VED ? '' : ' solo'}`}>
        <div className="ipgrid">
          <div className="ipr iphd"><span />{days.map((d, i) => <span key={d} className={d === today ? 'tod' : ''}><b>{DAYS[i]}</b> {dLab(d)}</span>)}</div>
          {people.map((x) => (
            <div key={x.id} className={`ipr${x.id === me && !VED ? ' me' : ''}`} style={{ height: h }}>
              <span className="ipw shwn"><span><span className="av">{x.name[0]}</span>{x.name}{x.id === me && !VED ? <em className="meb">Vy</em> : null}</span><small>{ROLE[x.role] ?? ''}</small></span>
              {days.map((d) => {
                const t = data.plan.find((p) => p.day === d && p.userId === x.id);
                const dr = draft?.find((p) => p.day === d && p.userId === x.id);
                const isOff = off.has(`${x.id}|${d}`);
                return (
                  <div key={d} className={`ipd${d === today ? ' tod' : ''}${isOff ? ' nosh' : ''}${d < today ? ' pst' : ''}`}>
                    {isOff ? <span className="ipsh off">volno</span> : null}
                    {t ? (
                      <button type="button" className={`ipc ${st(t)}`} onClick={() => (VED ? onPlan(d, x.id) : undefined)}>
                        <b>{label(t)}</b>
                        {t.places.length > 1 ? <small>{mist(t.places.length)}</small> : null}
                        {st(t) === 'late' ? <em>Po termínu</em> : st(t) === 'done' ? <em>Hotovo</em> : null}
                      </button>
                    ) : null}
                    {dr && dr.places.length !== (t?.places.length ?? 0) ? (
                      <span className="ipc draft"><span className="dtag">Návrh</span><b>{label({ ...dr, places: dr.places.filter((n) => !t?.places.includes(n)) })}</b></span>
                    ) : null}
                    {!t && VED && !isOff && d >= today ? <button type="button" className="ipadd" title="Naplánovat" onClick={() => onPlan(d, x.id)}>+</button> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {VED ? (
          <aside className="ipside">
            <div className="ipsb">
              <button type="button" className="btn sm" onClick={onShifts}>Směny</button>
              <button type="button" className="btn sm p" onClick={() => setDraft(propose(data))}>Navrhnout plán</button>
            </div>
            <b>Čeká na naplánování</b>
            <small>Místa, která potřebují kontrolu a nikdo je nemá v plánu.</small>
            {need.length ? need.map((pl) => (
              <div key={pl.name} className="ipn">
                <span><b>{pl.name}</b><small>{checkLabel(pl)}</small></span>
                <button type="button" className="btn sm" onClick={() => onPlan(undefined, undefined, pl.name)}>Naplánovat</button>
              </div>
            )) : <p className="ixe">Vše je naplánované.</p>}
          </aside>
        ) : null}
      </div>
      {VED ? <p className="ipnote">Klikněte na volné místo ve dni a naplánujete inventuru. Kliknutím na blok úkol upravíte.</p> : null}
    </div>
  );
}

function PlanModal({ data, owner, me, canPlan, init, onClose }: {
  data: InventoryData; owner: string; me: string; canPlan: boolean; init: { day?: string; user?: string; place?: string }; onClose: () => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(data.week.from, i)).filter((d) => d >= data.week.today);
  const [user, setUser] = useState(init.user ?? (canPlan ? (data.places.find((x) => x.name === init.place)?.group ? data.groups.find((g) => g.name === data.places.find((x) => x.name === init.place)?.group)?.person : null) ?? me : me));
  const [day, setDay] = useState(init.day ?? days[0] ?? data.week.today);
  const existing = (d: string, u: string) => data.plan.find((p) => p.day === d && p.userId === u)?.places ?? [];
  const [sel, setSel] = useState<Set<string>>(() => new Set([...existing(day, user), ...(init.place ? [init.place] : [])]));
  const elsewhere = useMemo(() => new Map(data.plan.filter((p) => !(p.day === day && p.userId === user)).flatMap((p) => p.places.map((n) => [n, p] as const))), [data.plan, day, user]);
  const off = new Set(data.shifts.map((s) => `${s.userId}|${s.day}`));
  const { pending, run, toast } = useRun();
  const pick = (d: string, u: string) => { setDay(d); setUser(u); setSel(new Set([...existing(d, u), ...(init.place ? [init.place] : [])])); };
  const nameOf = (id: string) => data.people.find((x) => x.id === id)?.name ?? '';
  return (
    <Modal title="Naplánovat inventuru" wide onClose={onClose} foot={<>
      <span className="note" style={{ marginRight: 'auto' }}>{mist(sel.size)} · {nf([...sel].reduce((s, n) => s + (data.places.find((x) => x.name === n)?.pcs ?? 0), 0))} ks</span>
      <button type="button" className="btn" onClick={onClose}>Zrušit</button>
      <button type="button" className="btn p" disabled={pending} onClick={() => run(() => planSet(owner, day, user, [...sel]), onClose)}>{sel.size ? 'Uložit' : 'Odebrat úkol'}</button>
    </>}>
      {toast}
      <div className="f"><label>Kdo</label>
        <div className="ipwho">
          {data.people.map((x) => <button key={x.id} type="button" className={`opt${user === x.id ? ' on' : ''}`} onClick={() => pick(day, x.id)}><span className="av">{x.name[0]}</span>{x.name}</button>)}
        </div>
      </div>
      <div className="f"><label>Kdy</label>
        <div className="ipdays">
          {days.map((d) => {
            const i = (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7;
            return <button key={d} type="button" className={`ipday${day === d ? ' on' : ''}`} disabled={off.has(`${user}|${d}`)} title={off.has(`${user}|${d}`) ? `${nameOf(user)} má volno` : DAYS_FULL[i]} onClick={() => pick(d, user)}><b>{DAYS[i]}</b><small>{dLab(d)}</small></button>;
          })}
        </div>
        {!days.length ? <small className="wsm">Tento týden už nejde nic naplánovat. Přepněte na příští týden.</small> : null}
      </div>
      <div className="f"><label>Místa</label>
        <div className="olist" style={{ maxHeight: 280, overflow: 'auto' }}>
          {data.places.map((pl) => {
            const other = elsewhere.get(pl.name);
            const on = sel.has(pl.name);
            return (
              <div key={pl.name} className="drow" style={{ cursor: 'pointer' }} onClick={() => setSel((s) => { const x = new Set(s); if (x.has(pl.name)) x.delete(pl.name); else x.add(pl.name); return x; })}>
                <span className={`cb${on ? ' on' : ''}`} />
                <span style={{ flex: 1 }}><b>{pl.name}</b> <small className="wsm">{pl.group ? `${pl.group} · ` : ''}{nf(pl.pcs)} ks{other ? ` · už v plánu ${dLab(other.day)}, ${nameOf(other.userId)}` : ''}</small></span>
                <span className={isOld(pl) ? 'old' : 'wsm'} style={{ fontSize: 12 }}>{checkLabel(pl)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function ShiftsModal({ data, owner, me, perms, onClose }: Props & { onClose: () => void }) {
  const VED = perms.includes('plan');
  const self = data.shiftMode === 'self';
  const { pending, run, toast } = useRun();
  const [modeV, setModeV] = useState<'lead' | 'self'>(data.shiftMode);
  const [lim, setLim] = useState(String(data.diffLimit));
  const days = Array.from({ length: 7 }, (_, i) => addDays(data.week.from, i));
  const off = new Set(data.shifts.map((s) => `${s.userId}|${s.day}`));
  const people = VED ? data.people : data.people.filter((x) => x.id === me);
  return (
    <Modal title={VED ? 'Směny a pravidla' : 'Kdy můžu pracovat'} wide onClose={onClose} foot={<>
      {VED ? <button type="button" className="btn" style={{ marginRight: 'auto' }} disabled={pending} onClick={() => run(() => teamSettings(owner, modeV, Number(lim) || 0))}>Uložit pravidla</button> : null}
      <button type="button" className="btn p" onClick={onClose}>Hotovo</button>
    </>}>
      {toast}
      <p className="ixlead">Týden {dLab(data.week.from)} – {dLab(data.week.to)}. Ve dnech volna plán úkol nedá. {self ? 'Volno si zapisuje každý sám.' : 'Volno zapisuje vedoucí.'}</p>
      <div className="ipgrid">
        <div className="ipr iphd"><span />{days.map((d, i) => <span key={d} className={d === data.week.today ? 'tod' : ''}><b>{DAYS[i]}</b> {dLab(d)}</span>)}</div>
        {people.map((x) => {
          const can = VED || (self && x.id === me);
          return (
            <div key={x.id} className="ipr">
              <span className="ipw"><span><span className="av">{x.name[0]}</span>{x.name}</span></span>
              {days.map((d) => {
                const isOff = off.has(`${x.id}|${d}`);
                return (
                  <div key={d} className={`ipd${isOff ? ' nosh' : ''}`} style={{ padding: 6, minHeight: 0, justifyContent: 'center' }}>
                    <button type="button" className={`btn sm${isOff ? '' : ' g'}`} disabled={!can || pending} style={{ width: '100%', justifyContent: 'center' }} onClick={() => run(() => shiftToggle(owner, x.id, d, !isOff))}>{isOff ? 'Volno' : 'Pracuje'}</button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {VED ? (
        <div className="sgrp">
          <div className="sgh">Pravidla</div>
          <div className="srow"><div><b>Kdo zapisuje volno</b><small>Vedoucí za všechny, nebo si ho každý zapíše sám.</small></div>
            <Seg value={modeV} onChange={(v) => setModeV(v as 'lead' | 'self')} style={{ width: 240 }} options={[['lead', 'Vedoucí'], ['self', 'Každý sám']]} /></div>
          <div className="srow"><div><b>Rozdíl bez schválení</b><small>Větší rozdíl z inventury zapíše do skladu až vedoucí. 0 = schvaluje se každý rozdíl.</small></div>
            <div className="inp" style={{ width: 140 }}><input value={lim} inputMode="numeric" onChange={(e) => setLim(e.target.value.replace(/\D/g, ''))} /><em>ks</em></div></div>
        </div>
      ) : null}
    </Modal>
  );
}
