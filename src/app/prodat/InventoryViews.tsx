'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, CardThumb } from '@/components/trezor';
import { formatDate, formatDateTime, formatNumber, plural } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';
import type { InventoryData, Inventory, Place, PlanTask } from './inventory';
import type { Perm } from './team';
import {
  groupSave, inventoryCancel, inventoryDecide, inventorySave, inventoryStart, placeSave, planApply, planSet, shiftToggle, type Res,
} from './team-actions';

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
const dayLabel = (d: string) => `${Number(d.slice(8, 10))}. ${Number(d.slice(5, 7))}.`;
const minutes = (s: number | null) => (s == null ? '' : s < 60 ? 'pod minutu' : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

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

/** Hlášení výsledku akce pod nástroji. */
function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<Res>, after?: (r: Res) => void) => start(async () => {
    const r = await fn();
    setMsg(r.error ? { ok: false, text: r.error } : r.text ? { ok: true, text: r.text } : null);
    if (!r.error) after?.(r);
  });
  const note = msg ? <p className={`tz-stk-msg ${msg.ok ? 'is-ok' : 'is-err'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null;
  return { pending, run, note, setMsg };
}

export function InventoryViews(p: Props) {
  const has = (x: Perm) => p.perms.includes(x);
  const review = p.data.inventories.filter((i) => i.status === 'review');
  const tabs: { key: InvView; label: string; n?: number; show: boolean }[] = [
    { key: 'mista', label: 'Místa', show: true },
    { key: 'kontrola', label: 'Ke kontrole', n: review.length, show: has('diff') },
    { key: 'historie', label: 'Hotové inventury', show: true },
    { key: 'plan', label: 'Plán', show: has('plan') || has('inv') },
    { key: 'smeny', label: 'Směny', show: has('plan') || has('inv') },
  ];
  const current = p.view === 'pocitani' ? 'mista' : p.view;
  return (
    <>
      <div className="tz-stk-tools" role="navigation" aria-label="Inventura">
        {tabs.filter((t) => t.show).map((t) => (
          <Link key={t.key} href={href(p.q, { pohled: t.key === 'mista' ? undefined : t.key })} className="tz-stk-fbtn" aria-pressed={current === t.key}>
            {t.label}{t.n ? <span className="tz-stk-n">{t.n}</span> : null}
          </Link>
        ))}
      </div>
      {p.view === 'mista' ? <Places {...p} /> : null}
      {p.view === 'pocitani' ? <Count {...p} /> : null}
      {p.view === 'kontrola' ? <Review list={review} /> : null}
      {p.view === 'historie' ? <Done list={p.data.inventories.filter((i) => i.status === 'done' || i.status === 'cancelled')} /> : null}
      {p.view === 'plan' ? <Plan {...p} /> : null}
      {p.view === 'smeny' ? <Shifts {...p} /> : null}
    </>
  );
}

// ===== Místa =====

function Due({ pl }: { pl: Place }) {
  if (!pl.lastChecked) return <span className="tz-stk-pay is-wait">Ještě nekontrolováno</span>;
  if (pl.overdue > 0) return <span className="tz-stk-pay is-wait">{plural(pl.overdue, ['den', 'dny', 'dní'])} po termínu</span>;
  if (pl.overdue >= -3) return <span className="tz-stk-pay is-cod">Brzy, za {plural(-pl.overdue, ['den', 'dny', 'dní'])}</span>;
  return <span className="tz-stk-pay is-ok">V pořádku</span>;
}

function Places({ data, owner, me, perms, q }: Props) {
  const router = useRouter();
  const { pending, run, note } = useRun();
  const canPlan = perms.includes('plan');
  const canInv = perms.includes('inv');
  const [edit, setEdit] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const nameOf = (id: string) => data.people.find((x) => x.id === id)?.name ?? '';
  const mine = data.places.filter((pl) => pl.today.includes(me));
  const late = data.places.filter((pl) => pl.overdue > 0).length;
  const running = data.places.filter((pl) => pl.counting).length;

  const start = (place: string) => run(() => inventoryStart(owner, place), (r) => router.push(href(q, { pohled: 'pocitani', inventura: r.id })));

  return (
    <>
      <div className="tz-stk-strip">
        <div><small>Míst</small><b>{data.places.length}</b></div>
        <div><small>Po termínu kontroly</small><b className={late ? 'tz-stk-down' : undefined}>{late}</b></div>
        <div><small>Právě se počítá</small><b>{running}</b></div>
        <div><small>Moje úkoly dnes</small><b>{mine.length}</b></div>
      </div>
      {mine.length ? (
        <p className="tz-stk-msg is-ok">Dnes máte spočítat: {mine.map((x) => x.name).join(', ')}.</p>
      ) : null}
      {note}
      <div className="tz-stk-shiphead">
        <div><b>Místa ve skladu</b><span className="t-small muted">Místo je umístění karty (např. krabice nebo šuplík). Nastavíte ho v detailu karty nebo hromadně.</span></div>
        {canPlan ? <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Zavřít' : 'Přidat místo'}</Button> : null}
      </div>
      {adding ? <PlaceForm owner={owner} groups={data.groups.map((g) => g.name)} onDone={() => setAdding(false)} /> : null}
      {!data.places.length ? (
        <div className="tz-stk-empty"><b>Zatím žádná místa</b>Jakmile kartám ve skladu nastavíte umístění, objeví se tu a půjde je počítat.</div>
      ) : (
        <div className="tz-table-wrap">
          <table className="tz-table">
            <thead>
              <tr><th>Místo</th><th>Skupina</th><th className="tz-num">Karet</th><th className="tz-num">Kusů</th><th>Poslední kontrola</th><th>Termín</th><th>Dnes počítá</th><th /></tr>
            </thead>
            <tbody>
              {data.places.map((pl) => (
                <PlaceRow key={pl.name} pl={pl} open={edit === pl.name} onEdit={canPlan ? () => setEdit(edit === pl.name ? null : pl.name) : undefined}
                  owner={owner} groups={data.groups.map((g) => g.name)} who={pl.today.map(nameOf).join(', ')}
                  action={pl.counting ? (
                    pl.counting.mine
                      ? <Link className="tz-btn tz-btn-primary tz-btn-sm" href={href(q, { pohled: 'pocitani', inventura: pl.counting.id })}>Pokračovat</Link>
                      : <span className="t-small tz-stk-muted">počítá {pl.counting.user}</span>
                  ) : canInv ? <Button size="sm" variant={pl.today.includes(me) ? 'primary' : 'secondary'} disabled={pending || !pl.rows} onClick={() => start(pl.name)}>Začít inventuru</Button> : null} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canPlan ? <Groups data={data} owner={owner} /> : null}
    </>
  );
}

function PlaceRow({ pl, open, onEdit, owner, groups, who, action }: {
  pl: Place; open: boolean; onEdit?: () => void; owner: string; groups: string[]; who: string; action: React.ReactNode;
}) {
  return (
    <>
      <tr>
        <td><b>{pl.name}</b></td>
        <td className="tz-muted">{pl.group ?? '–'}</td>
        <td className="tz-num">{formatNumber(pl.rows)}</td>
        <td className="tz-num">{formatNumber(pl.pcs)}</td>
        <td className="tz-muted">{pl.lastChecked ? `${formatDate(pl.lastChecked)} · každých ${pl.every} dní` : `každých ${pl.every} dní`}</td>
        <td><Due pl={pl} /></td>
        <td className="tz-muted">{who || '–'}</td>
        <td><div className="tz-stk-hacts">{onEdit ? <Button size="sm" variant="ghost" onClick={onEdit}>{open ? 'Zavřít' : 'Upravit'}</Button> : null}{action}</div></td>
      </tr>
      {open ? (
        <tr><td colSpan={8}><PlaceForm owner={owner} groups={groups} place={pl} onDone={onEdit} /></td></tr>
      ) : null}
    </>
  );
}

function PlaceForm({ owner, groups, place, onDone }: { owner: string; groups: string[]; place?: Place; onDone?: () => void }) {
  const { pending, run, note } = useRun();
  const [name, setName] = useState(place?.name ?? '');
  const [group, setGroup] = useState(place?.group ?? '');
  const [every, setEvery] = useState(place?.every ?? 30);
  return (
    <div className="tz-stk-inline">
      <label className="tz-stk-field">Místo<input value={name} disabled={!!place} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="např. Krabice A1" /></label>
      <label className="tz-stk-field">Skupina
        <input value={group} list="tz-stk-groups" maxLength={40} onChange={(e) => setGroup(e.target.value)} placeholder="např. Vitrína" />
        <datalist id="tz-stk-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      </label>
      <label className="tz-stk-field">Kontrolovat každých (dní)<input type="number" min={1} max={365} value={every} onChange={(e) => setEvery(Number(e.target.value))} /></label>
      <Button size="sm" disabled={pending || !name.trim()} onClick={() => run(() => placeSave(owner, name.trim(), group.trim(), every), () => onDone?.())}>Uložit</Button>
      {note}
    </div>
  );
}

function Groups({ data, owner }: { data: InventoryData; owner: string }) {
  const { pending, run, note } = useRun();
  const [name, setName] = useState('');
  const used = new Set(data.places.map((p) => p.group).filter(Boolean) as string[]);
  const list = [...data.groups, ...[...used].filter((g) => !data.groups.some((x) => x.name === g)).map((g) => ({ name: g, blind: false, person: null }))];
  return (
    <section className="tz-stk-box">
      <header><b>Skupiny míst</b><span className="t-small muted">Slepá inventura: kdo počítá, neuvidí, kolik kusů má podle skladu být. Kdo skupinu obvykle počítá, toho navrhne plán.</span></header>
      {note}
      {list.length ? (
        <div className="tz-table-wrap">
          <table className="tz-table">
            <thead><tr><th>Skupina</th><th>Míst</th><th>Slepá inventura</th><th>Obvykle počítá</th></tr></thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.name}>
                  <td><b>{g.name}</b></td>
                  <td className="tz-muted">{data.places.filter((p) => p.group === g.name).length}</td>
                  <td><input type="checkbox" checked={g.blind} disabled={pending} aria-label={`Slepá inventura ${g.name}`} onChange={(e) => run(() => groupSave(owner, g.name, e.target.checked, g.person))} /></td>
                  <td>
                    <select className="tz-stk-select" value={g.person ?? ''} disabled={pending} onChange={(e) => run(() => groupSave(owner, g.name, g.blind, e.target.value || null))}>
                      <option value="">Kdokoli</option>
                      {data.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="tz-stk-tools">
        <input className="tz-stk-search" style={{ flex: '0 1 260px' }} value={name} maxLength={40} placeholder="Nová skupina, např. Vitrína" onChange={(e) => setName(e.target.value)} />
        <Button size="sm" variant="secondary" disabled={pending || !name.trim()} onClick={() => run(() => groupSave(owner, name.trim(), false, null), () => setName(''))}>Přidat skupinu</Button>
      </div>
    </section>
  );
}

// ===== Počítání =====

function Count({ data, invId, q }: Props) {
  const router = useRouter();
  const inv = data.inventories.find((i) => i.id === invId);
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries((inv?.lines ?? []).map((l) => [l.listing_id, l.counted == null ? '' : String(l.counted)])));
  const [find, setFind] = useState('');
  const [noteText, setNoteText] = useState(inv?.note ?? '');
  const { pending, run, note } = useRun();

  if (!inv) return <div className="tz-stk-empty"><b>Inventura nenalezena</b><Link href={href(q, {})}>Zpět na místa</Link></div>;
  if (inv.status !== 'counting') {
    return <div className="tz-stk-empty"><b>Inventura místa {inv.place} už neběží</b><Link href={href(q, { pohled: 'historie' })}>Hotové inventury</Link></div>;
  }
  const blind = inv.blind;
  const lines = inv.lines.filter((l) => !find || `${l.name} ${l.set}`.toLowerCase().includes(find.toLowerCase()));
  const filled = inv.lines.filter((l) => counts[l.listing_id] !== '' && counts[l.listing_id] != null).length;
  const clean = () => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) if (v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0) out[k] = Number(v);
    return out;
  };
  const diffs = blind ? 0 : inv.lines.filter((l) => counts[l.listing_id] !== '' && Number(counts[l.listing_id]) !== l.expected).length;

  return (
    <>
      <div className="tz-stk-shiphead">
        <div>
          <b>Inventura · {inv.place}</b>
          {blind ? <span className="tz-stk-src">Slepá inventura</span> : null}
          <span className="t-small muted">začato {formatDateTime(inv.startedAt)}</span>
        </div>
        <div className="tz-stk-hacts">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => inventoryCancel(inv.id), () => router.push(href(q, {})))}>Zrušit inventuru</Button>
        </div>
      </div>
      <div className="tz-stk-strip">
        <div><small>Napočítáno</small><b>{filled} / {inv.lines.length}</b></div>
        {blind ? null : <div><small>Podle skladu</small><b>{formatNumber(inv.lines.reduce((s, l) => s + l.expected, 0))} ks</b></div>}
        {blind ? null : <div><small>Řádků s rozdílem</small><b className={diffs ? 'tz-stk-down' : undefined}>{diffs}</b></div>}
      </div>
      <div className="tz-stk-prog"><i style={{ width: `${inv.lines.length ? Math.round((filled / inv.lines.length) * 100) : 100}%` }} /></div>
      <div className="tz-stk-tools">
        <input className="tz-stk-search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Hledat kartu na místě" />
        <span className="t-small muted">{blind ? 'Spočítejte kusy a zapište je. Chybějící kartu zadejte jako 0.' : 'Zapište, kolik kusů opravdu je. Když sedí, stačí Sedí.'}</span>
      </div>
      {!inv.lines.length ? <div className="tz-stk-empty"><b>Na místě podle skladu nic není</b>Dokončete inventuru, nebo ji zrušte.</div> : (
        <div className="tz-table-wrap">
          <table className="tz-table">
            <thead><tr><th>Karta</th><th>Stav</th><th>Jazyk</th>{blind ? null : <th className="tz-num">Podle skladu</th>}<th>Napočítáno</th>{blind ? null : <th className="tz-num">Rozdíl</th>}</tr></thead>
            <tbody>
              {lines.map((l) => {
                const v = counts[l.listing_id] ?? '';
                const d = v === '' ? null : Number(v) - l.expected;
                return (
                  <tr key={l.listing_id}>
                    <td><span className="tz-stk-card"><CardThumb image={thumbUrl(l.image ?? undefined)} preview={l.image ?? undefined} /><span><b>{l.name}</b><small className="tz-stk-code">{l.set}</small></span></span></td>
                    <td><span className="tz-stk-cond">{l.cond}</span></td>
                    <td className="tz-muted">{LANGUAGE_NAMES[l.lang as Language] ?? l.lang}</td>
                    {blind ? null : <td className="tz-num">{l.expected}</td>}
                    <td>
                      <span className="tz-stk-cnt">
                        <input type="number" min={0} max={100000} inputMode="numeric" value={v} aria-label={`Napočítáno ${l.name}`}
                          onChange={(e) => setCounts((c) => ({ ...c, [l.listing_id]: e.target.value }))} />
                        {blind ? null : <button type="button" className="tz-stk-fbtn" onClick={() => setCounts((c) => ({ ...c, [l.listing_id]: String(l.expected) }))}>Sedí</button>}
                      </span>
                    </td>
                    {blind ? null : <td className={`tz-num ${d ? (d > 0 ? 'tz-stk-up' : 'tz-stk-down') : 'tz-muted'}`}>{d == null ? '' : d > 0 ? `+${d}` : d}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <label className="tz-stk-field">Poznámka pro vedoucího (nepovinná)<input value={noteText} maxLength={300} onChange={(e) => setNoteText(e.target.value)} placeholder="např. dvě karty byly v jiné krabici" /></label>
      {note}
      <div className="tz-stk-tools" style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" disabled={pending} onClick={() => run(() => inventorySave(inv.id, clean(), false, noteText))}>Uložit, dokončím později</Button>
        <Button disabled={pending || filled < inv.lines.length} onClick={() => run(() => inventorySave(inv.id, clean(), true, noteText), () => router.push(href(q, { pohled: 'historie' })))}>Dokončit inventuru</Button>
      </div>
    </>
  );
}

// ===== Ke kontrole a hotové =====

function DiffLines({ inv }: { inv: Inventory }) {
  const lines = inv.lines.filter((l) => l.counted != null && l.counted !== l.expected);
  if (!lines.length) return <p className="t-small muted">Všechno sedělo.</p>;
  return (
    <div className="tz-table-wrap">
      <table className="tz-table">
        <thead><tr><th>Karta</th><th>Stav</th><th className="tz-num">Podle skladu</th><th className="tz-num">Napočítáno</th><th className="tz-num">Rozdíl</th></tr></thead>
        <tbody>
          {lines.map((l) => {
            const d = (l.counted ?? 0) - l.expected;
            return (
              <tr key={l.listing_id}>
                <td><span className="tz-stk-card"><CardThumb image={thumbUrl(l.image ?? undefined)} preview={l.image ?? undefined} /><span><b>{l.name}</b><small className="tz-stk-code">{l.set}</small></span></span></td>
                <td><span className="tz-stk-cond">{l.cond}</span> <span className="t-small muted">{LANGUAGE_NAMES[l.lang as Language] ?? l.lang}</span></td>
                <td className="tz-num">{l.expected}</td>
                <td className="tz-num">{l.counted}</td>
                <td className={`tz-num ${d > 0 ? 'tz-stk-up' : 'tz-stk-down'}`}>{d > 0 ? `+${d}` : d}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const diffSum = (inv: Inventory) => inv.lines.reduce((s, l) => s + (l.counted == null ? 0 : l.counted - l.expected), 0);

function Review({ list }: { list: Inventory[] }) {
  const { pending, run, note } = useRun();
  if (!list.length) return <div className="tz-stk-empty"><b>Nic nečeká na kontrolu</b>Inventury s rozdílem, které člověk sám zapsat nesmí, se objeví tady.</div>;
  return (
    <>
      {note}
      {list.map((inv) => {
        const s = diffSum(inv);
        return (
          <section key={inv.id} className="tz-stk-box">
            <header>
              <b>{inv.place}</b>
              <span className="t-small muted">{inv.user} · {inv.finishedAt ? formatDateTime(inv.finishedAt) : ''} · trvalo {minutes(inv.seconds)} · celkem {s > 0 ? `+${s}` : s} ks{inv.blind ? ' · slepá' : ''}</span>
            </header>
            {inv.note ? <p className="t-small">Poznámka: {inv.note}</p> : null}
            <DiffLines inv={inv} />
            <div className="tz-stk-tools" style={{ justifyContent: 'flex-end' }}>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => inventoryDecide(inv.id, false))}>Poslat přepočítat</Button>
              <Button size="sm" disabled={pending} onClick={() => run(() => inventoryDecide(inv.id, true))}>Zapsat rozdíly do skladu</Button>
            </div>
          </section>
        );
      })}
    </>
  );
}

function Done({ list }: { list: Inventory[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!list.length) return <div className="tz-stk-empty"><b>Zatím žádná hotová inventura</b>Dokončené inventury se tu uloží i s rozdíly a tím, kdo je schválil.</div>;
  return (
    <div className="tz-table-wrap">
      <table className="tz-table">
        <thead><tr><th>Dokončeno</th><th>Místo</th><th>Počítal</th><th>Trvalo</th><th>Výsledek</th><th>Schválil</th></tr></thead>
        <tbody>
          {list.map((inv) => {
            const n = inv.lines.filter((l) => l.counted != null && l.counted !== l.expected).length;
            const res = inv.status === 'cancelled'
              ? <span className="tz-stk-pay is-cod">{inv.note?.includes('přepočítat') ? 'Poslat přepočítat' : 'Zrušeno'}</span>
              : n ? <span className="tz-stk-pay is-wait">{plural(n, ['rozdíl', 'rozdíly', 'rozdílů'])}, zapsáno</span> : <span className="tz-stk-pay is-ok">Vše sedí</span>;
            return (
              <FragmentRow key={inv.id} open={open === inv.id} onClick={() => setOpen(open === inv.id ? null : inv.id)}
                cells={<>
                  <td className="tz-muted">{formatDateTime(inv.finishedAt ?? inv.startedAt)}</td>
                  <td><b>{inv.place}</b></td>
                  <td>{inv.user}</td>
                  <td className="tz-muted">{minutes(inv.seconds)}</td>
                  <td>{res}</td>
                  <td className="tz-muted">{inv.decidedBy ?? (n ? 'sám' : '–')}</td>
                </>}
                detail={<>{inv.note ? <p className="t-small">Poznámka: {inv.note}</p> : null}<DiffLines inv={inv} /></>} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({ open, onClick, cells, detail }: { open: boolean; onClick: () => void; cells: React.ReactNode; detail: React.ReactNode }) {
  return (
    <>
      <tr className="tz-stk-row" onClick={onClick} aria-expanded={open}>{cells}</tr>
      {open ? <tr><td colSpan={6} className="tz-stk-sub">{detail}</td></tr> : null}
    </>
  );
}

// ===== Plán =====

function WeekNav({ data, q, view }: { data: InventoryData; q: string; view: InvView }) {
  const w = data.week;
  return (
    <div className="tz-stk-tools">
      <Link className="tz-stk-fbtn" href={href(q, { pohled: view, tyden: w.offset - 1 })}>← Předchozí</Link>
      <b className="t-small">Týden {dayLabel(w.from)} až {dayLabel(w.to)} {w.to.slice(0, 4)}</b>
      <Link className="tz-stk-fbtn" href={href(q, { pohled: view, tyden: w.offset + 1 })}>Další →</Link>
      {w.offset ? <Link className="t-small" href={href(q, { pohled: view })}>Tento týden</Link> : null}
    </div>
  );
}

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

function Plan({ data, owner, me, perms, q }: Props) {
  const canPlan = perms.includes('plan');
  const { pending, run, note } = useRun();
  const [cell, setCell] = useState<{ day: string; user: string } | null>(null);
  const [draft, setDraft] = useState<PlanTask[] | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(data.week.from, i));
  const off = new Set(data.shifts.map((s) => `${s.userId}|${s.day}`));
  const pcs = (names: string[]) => names.reduce((s, n) => s + (data.places.find((p) => p.name === n)?.pcs ?? 0), 0);
  const people = canPlan ? data.people : data.people.filter((x) => x.id === me);

  return (
    <>
      <div className="tz-stk-shiphead">
        <WeekNav data={data} q={q} view="plan" />
        {canPlan ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => setDraft(propose(data))}>Navrhnout plán</Button> : null}
      </div>
      {note}
      {draft ? (
        <section className="tz-stk-box">
          <header><b>Návrh plánu</b><span className="t-small muted">Místa po termínu a ta, kterým termín vyprší do konce týdne, rozdělená podle volna a počtu kusů.</span></header>
          {draft.length ? draft.map((t) => (
            <div key={`${t.userId}${t.day}`} className="tz-stk-odr" style={{ gridTemplateColumns: '120px 160px minmax(0,1fr) 90px' }}>
              <span>{DAYS[days.indexOf(t.day)]} {dayLabel(t.day)}</span><span>{data.people.find((x) => x.id === t.userId)?.name}</span>
              <span>{t.places.join(', ')}</span><span className="tz-num">{formatNumber(pcs(t.places))} ks</span>
            </div>
          )) : <p className="t-small muted">Tento týden není co plánovat, všechna místa jsou v termínu nebo už v plánu.</p>}
          <div className="tz-stk-tools" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>Zahodit</Button>
            {draft.length ? <Button size="sm" disabled={pending} onClick={() => run(() => planApply(owner, draft), () => setDraft(null))}>Použít návrh</Button> : null}
          </div>
        </section>
      ) : null}
      <div className="tz-table-wrap">
        <table className="tz-table tz-stk-week">
          <thead><tr><th>Kdo</th>{days.map((d, i) => <th key={d} aria-current={d === data.week.today ? 'date' : undefined}>{DAYS[i]} {dayLabel(d)}</th>)}</tr></thead>
          <tbody>
            {people.map((x) => (
              <tr key={x.id}>
                <td><b>{x.name}</b>{x.id === me ? <small className="tz-stk-muted"> (vy)</small> : null}</td>
                {days.map((d) => {
                  const t = data.plan.find((p) => p.day === d && p.userId === x.id);
                  const isOff = off.has(`${x.id}|${d}`);
                  const editable = canPlan && !isOff && d >= data.week.today;
                  return (
                    <td key={d} className={isOff ? 'is-off' : undefined}>
                      {isOff ? <span className="t-small tz-stk-muted">volno</span> : null}
                      {t ? <span className="tz-stk-tasks">{t.places.map((n) => <span key={n} className="tz-stk-task">{n}</span>)}</span> : null}
                      {editable ? <button type="button" className="tz-stk-celladd" onClick={() => setCell({ day: d, user: x.id })}>{t ? 'Upravit' : '+ Úkol'}</button> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cell ? (
        <TaskEditor data={data} owner={owner} day={cell.day} user={cell.user} onClose={() => setCell(null)}
          title={`${data.people.find((x) => x.id === cell.user)?.name} · ${DAYS[days.indexOf(cell.day)]} ${dayLabel(cell.day)}`} />
      ) : null}
    </>
  );
}

function TaskEditor({ data, owner, day, user, title, onClose }: { data: InventoryData; owner: string; day: string; user: string; title: string; onClose: () => void }) {
  const current = data.plan.find((p) => p.day === day && p.userId === user)?.places ?? [];
  const [sel, setSel] = useState<Set<string>>(new Set(current));
  const { pending, run, note } = useRun();
  const elsewhere = useMemo(() => new Map(data.plan.filter((p) => !(p.day === day && p.userId === user)).flatMap((p) => p.places.map((n) => [n, p] as const))), [data.plan, day, user]);
  return (
    <>
      <div className="tz-stk-drawer-bg" onClick={onClose} />
      <aside className="tz-stk-drawer" role="dialog" aria-label="Úkol inventury">
        <header><div><h2>Úkol inventury</h2><span className="t-small muted">{title}</span></div><Button variant="ghost" size="sm" onClick={onClose}>Zavřít</Button></header>
        <div className="tz-stk-drawer-body">
          <p className="t-small muted">Vyberte místa, která má ten den spočítat. Seřazeno od nejdéle nekontrolovaných.</p>
          <div className="tz-stk-picks">
            {data.places.map((pl) => {
              const other = elsewhere.get(pl.name);
              return (
                <label key={pl.name}>
                  <input type="checkbox" checked={sel.has(pl.name)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(pl.name); else n.delete(pl.name); return n; })} />
                  <span><b>{pl.name}</b><small>{pl.group ? `${pl.group} · ` : ''}{formatNumber(pl.pcs)} ks{other ? ` · už v plánu ${dayLabel(other.day)}` : ''}</small></span>
                  <Due pl={pl} />
                </label>
              );
            })}
          </div>
          {note}
        </div>
        <footer>
          <span className="t-small muted">{plural(sel.size, ['místo', 'místa', 'míst'])}</span>
          <Button disabled={pending} onClick={() => run(() => planSet(owner, day, user, [...sel]), onClose)}>Uložit</Button>
        </footer>
      </aside>
    </>
  );
}

// ===== Směny =====

function Shifts({ data, owner, me, perms, q }: Props) {
  const canPlan = perms.includes('plan');
  const self = data.shiftMode === 'self';
  const { pending, run, note } = useRun();
  const days = Array.from({ length: 7 }, (_, i) => addDays(data.week.from, i));
  const off = new Set(data.shifts.map((s) => `${s.userId}|${s.day}`));
  return (
    <>
      <div className="tz-stk-shiphead">
        <WeekNav data={data} q={q} view="smeny" />
        <span className="t-small muted">{self ? 'Volno si zapisuje každý sám.' : 'Volno zapisuje vedoucí.'} Ve dnech volna plán úkol nedá.</span>
      </div>
      {note}
      <div className="tz-table-wrap">
        <table className="tz-table tz-stk-week">
          <thead><tr><th>Kdo</th>{days.map((d, i) => <th key={d} aria-current={d === data.week.today ? 'date' : undefined}>{DAYS[i]} {dayLabel(d)}</th>)}</tr></thead>
          <tbody>
            {data.people.map((x) => {
              const can = canPlan || (self && x.id === me);
              return (
                <tr key={x.id}>
                  <td><b>{x.name}</b>{x.id === me ? <small className="tz-stk-muted"> (vy)</small> : null}</td>
                  {days.map((d) => {
                    const isOff = off.has(`${x.id}|${d}`);
                    return (
                      <td key={d} className={isOff ? 'is-off' : undefined}>
                        {can ? (
                          <button type="button" className="tz-stk-shift" aria-pressed={isOff} disabled={pending} onClick={() => run(() => shiftToggle(owner, x.id, d, !isOff))}>
                            {isOff ? 'Volno' : 'Pracuje'}
                          </button>
                        ) : <span className="t-small tz-stk-muted">{isOff ? 'Volno' : 'Pracuje'}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
