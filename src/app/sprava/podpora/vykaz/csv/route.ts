import { getCurrentUser } from '@/lib/auth';
import { caseCode, KIND, minutesOf, pragueDay, weekFrom } from '@/lib/support';
import { loadWeek } from '../data';

/** Výkaz času za týden jako CSV (středníky a UTF-8 s BOM, aby ho Excel otevřel česky). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return new Response('Nenalezeno', { status: 404 });
  const monday = weekFrom(new URL(req.url).searchParams.get('od') ?? undefined);
  const { rows, names } = await loadWeek(monday);
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['Den', 'Kdo', 'Případ', 'Předmět', 'Typ', 'Minut', 'Poznámka'].join(';')];
  for (const t of rows) {
    const c = t.support_cases;
    lines.push([
      pragueDay(t.started_at),
      names.get(t.staff_id ?? '') ?? '',
      c ? caseCode(c.number) : '',
      c?.subject ?? '',
      c ? KIND[c.kind] : '',
      String(Math.round(minutesOf(t))),
      t.note ?? '',
    ].map(esc).join(';'));
  }
  return new Response(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="vykaz-podpory-${monday}.csv"`,
    },
  });
}
