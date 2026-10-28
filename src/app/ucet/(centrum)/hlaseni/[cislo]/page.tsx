import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ReportPanel } from '@/components/reports/ReportPanel';
import { getCurrentUser } from '@/lib/auth';
import { loadReportFiles, REPORT_SELECT, reportCode, type ReportRow } from '@/lib/reports';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

type Props = { params: Promise<{ cislo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cislo } = await params;
  return { title: `Hlášení ${reportCode(Number(cislo) || 0)}` };
}

export default async function ReportDetailPage({ params }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const { cislo } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/prihlaseni?dalsi=/ucet/hlaseni/${encodeURIComponent(cislo)}`);
  const number = Number(cislo);
  if (!Number.isInteger(number) || number < 1) notFound();
  const supabase = await createClient();
  const { data: r } = await supabase.from('reports').select(REPORT_SELECT).eq('number', number).maybeSingle<ReportRow>();
  if (!r || (r.reporter_id !== user.id && r.against_id !== user.id)) notFound();
  const otherId = r.reporter_id === user.id ? r.against_id : r.reporter_id;
  const [files, { data: other }] = await Promise.all([
    loadReportFiles(supabase, r.id),
    otherId ? supabase.from('profiles').select('display_name').eq('id', otherId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Link href="/ucet/hlaseni" className="t-small">← Hlášení</Link>
      <ReportPanel r={r} me={user.id} files={files} otherName={(other?.display_name as string | undefined) ?? 'smazaný účet'} />
    </div>
  );
}
