'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import { formatDate } from '@/lib/format';
import { PERMS, ROLE_NAMES, type Perm, type TeamData } from './team';
import { rolesSave, staffAdd, staffRemove, staffRole, teamSettings, type Res } from './team-actions';

function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<Res>, after?: () => void) => start(async () => {
    const r = await fn();
    setMsg(r.error ? { ok: false, text: r.error } : r.text ? { ok: true, text: r.text } : null);
    if (!r.error) after?.();
  });
  const note = msg ? <p className={`tz-stk-msg ${msg.ok ? 'is-ok' : 'is-err'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null;
  return { pending, run, note };
}

const ROLE_HINT: Record<string, string> = {
  ved: 'Může všechno jako majitel, kromě smazání obchodu.',
  pro: 'Obsluha a prodej: sklad, ceny, objednávky.',
  skl: 'Jen přidělené inventury.',
};

/** Zaměstnanci a role: kdo je v týmu, co která role smí, nastavení inventur a směn. */
export function TeamView({ owner, ownerName, me, isOwner, team }: { owner: string; ownerName: string; me: string; isOwner: boolean; team: TeamData }) {
  return (
    <>
      <People owner={owner} ownerName={ownerName} me={me} isOwner={isOwner} team={team} />
      <Roles owner={owner} team={team} />
      <Settings owner={owner} team={team} />
    </>
  );
}

function People({ owner, ownerName, me, isOwner, team }: { owner: string; ownerName: string; me: string; isOwner: boolean; team: TeamData }) {
  const { pending, run, note } = useRun();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('pro');
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <section className="tz-stk-box">
      <header>
        <b>Lidé v týmu</b>
        <span className="t-small muted">Člověk se přihlašuje svým účtem V4cards. Sklad obchodu pak najde v menu Sklad a přepne se na něj nahoře.</span>
      </header>
      <div className="tz-table-wrap">
        <table className="tz-table">
          <thead><tr><th>Jméno</th><th>E-mail</th><th>Role</th><th>V týmu od</th><th /></tr></thead>
          <tbody>
            <tr>
              <td><b>{ownerName}</b>{isOwner ? <small className="tz-stk-muted"> (vy)</small> : null}</td>
              <td className="tz-muted">–</td>
              <td>Majitel</td>
              <td className="tz-muted">–</td>
              <td />
            </tr>
            {team.members.map((m) => (
              <tr key={m.id}>
                <td><b>{m.name}</b>{m.id === me ? <small className="tz-stk-muted"> (vy)</small> : null}</td>
                <td className="tz-muted">{m.email ?? '–'}</td>
                <td>
                  <select className="tz-stk-select" value={m.role} disabled={pending || m.id === me} aria-label={`Role ${m.name}`}
                    onChange={(e) => run(() => staffRole(owner, m.id, e.target.value))}>
                    {Object.entries(ROLE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="tz-muted">{formatDate(m.since)}</td>
                <td>
                  {m.id === me ? null : confirm === m.id ? (
                    <div className="tz-stk-hacts">
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Ne</Button>
                      <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => staffRemove(owner, m.id), () => setConfirm(null))}>Odebrat z týmu</Button>
                    </div>
                  ) : <Button size="sm" variant="ghost" onClick={() => setConfirm(m.id)}>Odebrat</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note}
      <form className="tz-stk-inline" onSubmit={(e) => { e.preventDefault(); run(() => staffAdd(owner, email, role), () => setEmail('')); }}>
        <label className="tz-stk-field">E-mail účtu V4cards<input type="email" required value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} placeholder="jmeno@email.cz" /></label>
        <label className="tz-stk-field">Role
          <select className="tz-stk-select" value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(ROLE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <Button type="submit" size="sm" disabled={pending || !email.trim()}>Přidat do týmu</Button>
        <span className="t-small muted">{ROLE_HINT[role]}</span>
      </form>
    </section>
  );
}

function Roles({ owner, team }: { owner: string; team: TeamData }) {
  const { pending, run, note } = useRun();
  const [m, setM] = useState<Record<'pro' | 'skl', Set<Perm>>>({ pro: new Set(team.roles.pro), skl: new Set(team.roles.skl) });
  const toggle = (role: 'pro' | 'skl', p: Perm) => setM((x) => {
    const s = new Set(x[role]);
    if (s.has(p)) s.delete(p); else s.add(p);
    return { ...x, [role]: s };
  });
  const changed = (['pro', 'skl'] as const).some((r) => m[r].size !== team.roles[r].length || team.roles[r].some((p) => !m[r].has(p)));
  return (
    <section className="tz-stk-box">
      <header><b>Co která role smí</b><span className="t-small muted">Vedoucí smí všechno. Změna platí hned pro všechny lidi v roli.</span></header>
      <div className="tz-table-wrap">
        <table className="tz-table tz-stk-matrix">
          <thead><tr><th>Právo</th><th>Vedoucí</th><th>Prodavač</th><th>Skladník</th></tr></thead>
          <tbody>
            {PERMS.map(([p, label]) => (
              <tr key={p}>
                <td>{label}</td>
                <td><input type="checkbox" checked disabled aria-label={`Vedoucí: ${label}`} /></td>
                {(['pro', 'skl'] as const).map((r) => (
                  <td key={r}><input type="checkbox" checked={m[r].has(p)} onChange={() => toggle(r, p)} aria-label={`${ROLE_NAMES[r]}: ${label}`} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note}
      <div className="tz-stk-tools" style={{ justifyContent: 'flex-end' }}>
        <Button size="sm" disabled={pending || !changed} onClick={() => run(() => rolesSave(owner, { pro: [...m.pro], skl: [...m.skl] }))}>Uložit práva</Button>
      </div>
    </section>
  );
}

function Settings({ owner, team }: { owner: string; team: TeamData }) {
  const { pending, run, note } = useRun();
  const [mode, setMode] = useState(team.shiftMode);
  const [limit, setLimit] = useState(team.diffLimit);
  return (
    <section className="tz-stk-box">
      <header><b>Inventury a směny</b></header>
      <div className="tz-stk-tools" role="radiogroup" aria-label="Kdo zapisuje volno">
        <span className="t-small muted">Volno ve směnách zapisuje</span>
        <button type="button" className="tz-stk-fbtn" aria-pressed={mode === 'lead'} onClick={() => setMode('lead')}>Vedoucí</button>
        <button type="button" className="tz-stk-fbtn" aria-pressed={mode === 'self'} onClick={() => setMode('self')}>Každý sám</button>
      </div>
      <label className="tz-stk-field" style={{ maxWidth: 520 }}>
        Rozdíl v inventuře do kolika kusů smí zapsat do skladu rovnou člověk s právem Vidět rozdíly (větší čeká na schválení, majitel zapisuje vždy)
        <input type="number" min={0} max={100000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
      </label>
      {note}
      <div className="tz-stk-tools" style={{ justifyContent: 'flex-end' }}>
        <Button size="sm" disabled={pending || (mode === team.shiftMode && limit === team.diffLimit)} onClick={() => run(() => teamSettings(owner, mode, limit))}>Uložit</Button>
      </div>
    </section>
  );
}
