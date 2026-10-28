import { createClient } from '@/lib/supabase/server';
import { addDays, pragueMidnight, TIME_SELECT, weekReport, type CaseKind, type CaseStatus, type TimeRow } from '@/lib/support';

/** Načte záznamy času pro týden od pondělí a spočítá výkaz. */
export async function loadWeek(monday: string) {
  const supabase = await createClient();
  const from = pragueMidnight(monday).toISOString();
  const to = pragueMidnight(addDays(monday, 7)).toISOString();
  const [{ data }, { data: staff }] = await Promise.all([
    supabase.from('case_time').select(TIME_SELECT).gte('started_at', from).lt('started_at', to).order('started_at')
      .returns<Array<TimeRow & { support_cases: { number: number; subject: string; kind: CaseKind; status: CaseStatus; resolved_at: string | null } | null }>>(),
    supabase.rpc('admin_staff'),
  ]);
  const names = new Map(((staff ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name.split(' ')[0]]));
  return { report: weekReport(monday, data ?? [], names), rows: data ?? [], names };
}
