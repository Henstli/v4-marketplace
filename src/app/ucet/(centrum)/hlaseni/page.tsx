import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Status } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { SupportTabs } from '@/components/account/PageTabs';
import { formatDate } from '@/lib/format';
import { REASON, REPORT_SELECT, reportCode, reportLabel, type ReportRow } from '@/lib/reports';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import styles from '@/components/reports/reports.module.css';

export const metadata: Metadata = { title: 'Moje hlášení' };

/** Účet › Hlášení (DS Reports, obrazovka 4): hlášení, která jsem podal, nebo která se mě týkají. */
export default async function ReportsPage() {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/ucet/hlaseni');
  const supabase = await createClient();
  const { data } = await supabase.from('reports').select(REPORT_SELECT)
    .or(`reporter_id.eq.${user.id},against_id.eq.${user.id}`)
    .order('created_at', { ascending: false }).limit(100).returns<ReportRow[]>();
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => (r.reporter_id === user.id ? r.against_id : r.reporter_id)).filter((x): x is string => !!x))];
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]));
  // Nahoře ta, kde je uživatel na tahu, pak otevřená, pak uzavřená.
  const rank = (r: ReportRow) => (r.status === 'closed' ? 2 : reportLabel(r, user.id).tone === 'warn' ? 0 : 1);
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <h1 className="t-heading-l">Podpora</h1>
        <SupportTabs current="/ucet/hlaseni" reports={sorted.filter((r) => r.status !== 'closed').length || undefined} />
        <p className="muted">Problémy s objednávkami, které jste nahlásili vy, nebo které se týkají vás. Nahlásit jde v detailu objednávky.</p>
      </div>
      {sorted.length ? (
        <ul className={styles.list}>
          {sorted.map((r) => {
            const l = reportLabel(r, user.id);
            const other = (r.reporter_id === user.id ? r.against_id : r.reporter_id) ?? '';
            return (
              <li key={r.id}>
                <Link href={`/ucet/hlaseni/${r.number}`} className={styles.card}>
                  <span className={styles.cardTop}>
                    <span className="code">{reportCode(r.number)}</span>
                    <Status tone={l.tone}>{l.text}</Status>
                  </span>
                  <strong>{REASON[r.reason]}</strong>
                  <span className="t-small muted">
                    Objednávka č. {r.orders?.number ?? '?'} · {r.reporter_id === user.id ? (r.reporter_role === 'buyer' ? 'prodejce' : 'kupující') : 'nahlásil(a)'} {names.get(other) ?? 'smazaný účet'} · {formatDate(r.created_at)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Zatím žádná hlášení. Když bude s objednávkou problém, najdete „Nahlásit problém“ v jejím detailu.</p>
      )}
    </div>
  );
}
