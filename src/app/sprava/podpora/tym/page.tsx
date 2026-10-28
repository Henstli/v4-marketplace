import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { setTeamRole } from './actions';
import styles from '../podpora.module.css';

export const metadata: Metadata = { title: 'Tým · podpora' };

type Props = { searchParams: Promise<{ ok?: string; chyba?: string }> };

interface Member { user_id: string; display_name: string | null; email: string; role: 'admin' | 'support'; added_at: string }
interface LogRow { id: number; staff_id: string | null; user_id: string; old_role: string | null; new_role: string | null; created_at: string }

const ROLE = { admin: 'Správce', support: 'Podpora' } as Record<string, string>;

function change(r: LogRow) {
  if (!r.old_role) return `Přidán(a) jako ${ROLE[r.new_role!]}`;
  if (!r.new_role) return 'Odebrán(a) z týmu';
  return `${ROLE[r.old_role]} → ${ROLE[r.new_role]}`;
}

/** Tým V4cards: role Správce a Podpora (DS Support, Tým). Jen pro správce. */
export default async function TeamPage({ searchParams }: Props) {
  const { ok, chyba } = await searchParams;
  const user = await getCurrentUser();
  if (!user?.isAdmin) notFound();
  const supabase = await createClient();
  const [{ data: team }, { data: log }] = await Promise.all([
    supabase.rpc('team_list'),
    supabase.from('team_log').select('*').order('created_at', { ascending: false }).limit(50).returns<LogRow[]>(),
  ]);
  const members = (team ?? []) as Member[];
  const ids = [...new Set((log ?? []).flatMap((r) => [r.user_id, r.staff_id]).filter((x): x is string => !!x))];
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]));

  return (
    <div className={styles.page}>
      <h1 className="t-heading-l">Tým</h1>
      <p className={styles.small}>
        <strong>Správce</strong> smí všechno: podporu, schvalování karet, předplatné a ověření prodejců i tým.{' '}
        <strong>Podpora</strong> vidí jen režim podpory: frontu, uživatele, omezení účtů, hlášení a výkaz času.
        Celý tým má výhody tarifu Pro, ale v sekci Obchody Pro na úvodní stránce se neukazuje.
      </p>
      {ok ? <p className={styles.flash}>{ok}</p> : null}
      {chyba ? <p className={`${styles.flash} ${styles.flashErr}`}>{chyba}</p> : null}

      <form action={setTeamRole} className={styles.box} style={{ maxWidth: 720 }}>
        <h2 className={styles.boxTitle}>PŘIDAT DO TÝMU</h2>
        <div className={styles.row}>
          <label className={styles.field} style={{ flex: '1 1 260px' }}>E-mail
            <input className={styles.input} name="email" type="email" required placeholder="E-mail účtu na V4cards" />
          </label>
          <label className={styles.field}>Role
            <select className={styles.input} name="role" defaultValue="support">
              <option value="support">Podpora</option>
              <option value="admin">Správce</option>
            </select>
          </label>
        </div>
        <p className={styles.small}>Člověk musí mít na V4cards účet. Pro přístup potřebuje zapnuté dvoufázové ověření.</p>
        <div><Button type="submit">Přidat</Button></div>
      </form>

      <div className={`${styles.box} ${styles.tableWrap}`}>
        <table className={styles.table}>
          <thead><tr><th>ČLEN</th><th>E-MAIL</th><th>ROLE</th><th>V TÝMU OD</th><th></th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td><Link href={`/sprava/podpora/uzivatele/${m.user_id}`}>{m.display_name ?? m.email}</Link></td>
                <td className={styles.small}>{m.email}</td>
                <td>{ROLE[m.role]}</td>
                <td className={styles.small}>{formatDate(m.added_at)}</td>
                <td>
                  {m.user_id === user.id ? <span className={styles.small}>Vy</span> : (
                    <div className={styles.row}>
                      <form action={setTeamRole}>
                        <input type="hidden" name="email" value={m.email} />
                        <input type="hidden" name="role" value={m.role === 'admin' ? 'support' : 'admin'} />
                        <Button type="submit" variant="ghost">{m.role === 'admin' ? 'Změnit na Podpora' : 'Změnit na Správce'}</Button>
                      </form>
                      <form action={setTeamRole}>
                        <input type="hidden" name="email" value={m.email} />
                        <input type="hidden" name="role" value="none" />
                        <Button type="submit" variant="ghost">Odebrat z týmu</Button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className={styles.box}>
        <h2 className={styles.boxTitle}>HISTORIE TÝMU</h2>
        <ul className={styles.list}>
          {(log ?? []).map((r) => (
            <li key={r.id} className={styles.hist}>
              <span className={styles.small}>{formatDateTime(r.created_at)}</span>
              <span><strong>{names.get(r.user_id) ?? 'smazaný účet'}</strong><span className={styles.small}>{change(r)}</span></span>
              <span className={styles.small}>{r.staff_id ? names.get(r.staff_id) ?? 'správce' : 'systém'}</span>
            </li>
          ))}
          {!log?.length ? <li className={styles.small}>Zatím beze změn.</li> : null}
        </ul>
      </section>
    </div>
  );
}
