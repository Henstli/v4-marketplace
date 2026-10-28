import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ReportPanel } from '@/components/reports/ReportPanel';
import { Status } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { loadReportFiles, OUTCOME, REASON, REPORT_SELECT, reportCode, type ReportRow } from '@/lib/reports';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import rs from '@/components/reports/reports.module.css';
import styles from '../../karty/admin.module.css';

export const metadata: Metadata = { title: 'Hlášení · správa' };

type Props = { searchParams: Promise<{ h?: string; vse?: string }> };

/** Dočasná správa hlášení pro podporu, než vznikne dashboard: seznam, detail, vyjádření a uzavření. */
export default async function AdminReportsPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/sprava/podpora/hlaseni');
  if (!user.isAdmin) notFound();
  const { h, vse } = await searchParams;
  const supabase = await createClient();
  let q = supabase.from('reports').select(REPORT_SELECT).order('created_at', { ascending: false }).limit(200);
  if (!vse) q = q.neq('status', 'closed');
  const { data } = await q.returns<ReportRow[]>();
  const rows = data ?? [];
  const ids = [...new Set(rows.flatMap((r) => [r.reporter_id, r.against_id]).filter((x): x is string => !!x))];
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]));
  const sel = rows.find((r) => String(r.number) === h) ?? null;
  const files = sel ? await loadReportFiles(supabase, sel.id) : [];
  // Podpora nejdřív vidí ta, která čekají na ni, pak ta s nejbližší lhůtou.
  const order = (r: ReportRow) => (r.status === 'review' ? 0 : r.status === 'closed' ? 2 : 1);
  const sorted = [...rows].sort((a, b) => order(a) - order(b) || (a.due_at ?? '9').localeCompare(b.due_at ?? '9'));

  return (
    <div className={styles.page}>
      <div>
        <h1 className="t-heading-l">Hlášení</h1>
        <p className="muted">{vse ? <Link href="/sprava/podpora/hlaseni">Jen otevřená</Link> : <Link href="/sprava/podpora/hlaseni?vse=1">Zobrazit i uzavřená</Link>}</p>
      </div>
      <div className={rs.grid}>
        <ul className={rs.list}>
          {sorted.map((r) => (
            <li key={r.id}>
              <Link href={`/sprava/podpora/hlaseni?h=${r.number}${vse ? '&vse=1' : ''}`} className={rs.card} aria-current={sel?.id === r.id ? 'page' : undefined}>
                <span className={rs.cardTop}>
                  <span className="code">{reportCode(r.number)}</span>
                  <Status tone={r.status === 'review' ? 'warn' : r.status === 'closed' ? 'muted' : 'info'}>
                    {r.status === 'review' ? 'Na podpoře' : r.status === 'closed' ? (r.outcome ? OUTCOME[r.outcome] : 'Uzavřeno') : 'Domlouvají se'}
                  </Status>
                </span>
                <strong>{REASON[r.reason]}</strong>
                <span className="t-small muted">
                  č. {r.orders?.number} · {names.get(r.reporter_id ?? '') ?? '?'} → {names.get(r.against_id ?? '') ?? '?'} · {formatDateTime(r.created_at)}
                  {r.due_at ? ` · lhůta ${formatDateTime(r.due_at)}` : ''}
                </span>
              </Link>
            </li>
          ))}
          {!sorted.length ? <li className="muted">Žádná otevřená hlášení.</li> : null}
        </ul>
        {sel ? (
          <ReportPanel r={sel} me={user.id} files={files} admin otherName={`${names.get(sel.reporter_id ?? '') ?? '?'} (${sel.reporter_role === 'buyer' ? 'kupující' : 'prodejce'}) → ${names.get(sel.against_id ?? '') ?? '?'}`} />
        ) : <p className="muted">Vyberte hlášení vlevo.</p>}
      </div>
    </div>
  );
}
