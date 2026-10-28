import { getCurrentUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { monthReport, pragueMidnight, shiftMonth, TIME_SELECT, type TimeWithCase } from '@/lib/support';

/**
 * Záznamy času za měsíc a výkaz. Správce vidí všechny, podpora jen sebe.
 * kdo = jen jeden člověk z týmu (filtr záznamů a CSV).
 */
export async function loadMonth(month: string, kdo?: string) {
  const user = (await getCurrentUser())!;
  const supabase = await createClient();
  const from = pragueMidnight(`${month}-01`).toISOString();
  const to = pragueMidnight(`${shiftMonth(month, 1)}-01`).toISOString();
  let q = supabase.from('case_time').select(TIME_SELECT).gte('started_at', from).lt('started_at', to).order('started_at');
  if (!user.isAdmin) q = q.eq('staff_id', user.id);
  const [{ data }, { data: staff }] = await Promise.all([q.returns<TimeWithCase[]>(), supabase.rpc('admin_staff')]);
  const names = new Map(((staff ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name.split(' ')[0]]));
  const all = data ?? [];
  const who = user.isAdmin && kdo && names.has(kdo) ? kdo : null;
  return {
    report: monthReport(all, names, month),
    rows: who ? all.filter((t) => t.staff_id === who) : all,
    names,
    who,
    admin: user.isAdmin,
    me: user.id,
  };
}
