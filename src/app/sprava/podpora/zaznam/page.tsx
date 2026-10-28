import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { ACTION_LABEL, reasonOf, type ModAction } from '@/lib/support';
import styles from '../podpora.module.css';

export const metadata: Metadata = { title: 'Záznam akcí · podpora' };

interface ActionRow { id: number; staff_id: string | null; user_id: string | null; action: ModAction; reason_code: string | null; detail: string | null; until: string | null; created_at: string }

/** Záznam akcí správců. Nejde upravit ani smazat (hlídá databáze). */
export default async function AuditLogPage() {
  const supabase = await createClient();
  const [{ data }, { data: staff }] = await Promise.all([
    supabase.from('staff_actions').select('id, staff_id, user_id, action, reason_code, detail, until, created_at')
      .order('created_at', { ascending: false }).limit(300).returns<ActionRow[]>(),
    supabase.rpc('admin_staff'),
  ]);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]));
  const staffNames = new Map(((staff ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name.split(' ')[0]]));

  return (
    <div className={styles.page}>
      <h1 className="t-heading-l">Záznam akcí</h1>
      <p className={styles.small}>Omezení účtů, změny tarifů a ověření prodejců. Záznam nejde upravit ani smazat.</p>
      <div className={`${styles.box} ${styles.tableWrap}`}>
        <table className={styles.table}>
          <thead><tr><th>KDY</th><th>KDO</th><th>AKCE</th><th>UŽIVATEL</th><th>DŮVOD</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={styles.small}>{formatDateTime(r.created_at)}</td>
                <td>{r.staff_id ? staffNames.get(r.staff_id) ?? 'správce' : 'systém'}</td>
                <td>{ACTION_LABEL[r.action]}{r.until ? ` do ${formatDate(r.until)}` : ''}</td>
                <td>{r.user_id ? <Link href={`/sprava/podpora/uzivatele/${r.user_id}`}>{names.get(r.user_id) ?? 'smazaný účet'}</Link> : '–'}</td>
                <td className={styles.small}>{reasonOf(r.reason_code)?.label ?? r.detail ?? '–'}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={5} className={styles.dash}>Zatím nic.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
