import { getCurrentUser } from '@/lib/auth';
import { caseCode, KIND, minutesOf, monthFrom, pragueDay } from '@/lib/support';
import { loadMonth } from '../data';

/** Výkaz času za měsíc jako CSV (středníky a UTF-8 s BOM, aby ho Excel otevřel česky). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user?.isStaff) return new Response('Nenalezeno', { status: 404 });
  const params = new URL(req.url).searchParams;
  const month = monthFrom(params.get('mesic') ?? undefined);
  const { rows, names } = await loadMonth(month, params.get('kdo') ?? undefined);
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['Den', 'Kdo', 'Případ', 'Předmět', 'Typ', 'Minut', 'Poznámka'].join(';')];
  for (const t of rows) {
    const c = t.support_cases;
    lines.push([
      pragueDay(t.started_at),
      names.get(t.staff_id ?? '') ?? '',
      c ? caseCode(c.number) : '',
      c?.subject ?? 'Ostatní práce',
      c ? KIND[c.kind] : '',
      String(Math.round(minutesOf(t))),
      t.note ?? '',
    ].map(esc).join(';'));
  }
  return new Response(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="vykaz-podpory-${month}.csv"`,
    },
  });
}
