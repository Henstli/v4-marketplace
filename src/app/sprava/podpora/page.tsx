import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, ChipLink, SearchField } from '@/components/trezor';
import { AutoRefresh } from '@/components/support/AutoRefresh';
import { getCurrentUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  caseCode, dueGroup, dueText, GROUP_LABEL, hmLong, KIND, minutesOf, PRIORITY, pragueDay, pragueMidnight,
  type CaseRow, type DueGroup, type TimeRow,
} from '@/lib/support';
import styles from './podpora.module.css';

export const metadata: Metadata = { title: 'Podpora · správa' };

type Props = { searchParams: Promise<{ f?: string; q?: string }> };

const FILTERS = [
  { id: '', label: 'Moje a nepřiřazené' },
  { id: 'vse', label: 'Všechny' },
  { id: 'report', label: 'Hlášení objednávek' },
  { id: 'question', label: 'Dotazy' },
  { id: 'appeal', label: 'Odvolání' },
  { id: 'vyresene', label: 'Vyřešené' },
];
const ORDER: DueGroup[] = ['late', 'today', 'week', 'later', 'waiting', 'resolved'];
const PRIO_RANK = { high: 0, mid: 1, low: 2 } as const;

/** Fronta případů podpory seřazená podle termínu (DS Support, Fronta). */
export default async function SupportQueuePage({ searchParams }: Props) {
  const { f = '', q = '' } = await searchParams;
  const user = (await getCurrentUser())!;
  const supabase = await createClient();
  const now = new Date();
  const todayStart = pragueMidnight(pragueDay(now)).toISOString();

  const resolved = f === 'vyresene';
  let query = supabase.from('support_cases').select('*');
  query = resolved
    ? query.eq('status', 'resolved').order('resolved_at', { ascending: false }).limit(100)
    : query.neq('status', 'resolved').limit(500);
  const [{ data: cases }, { data: time }, { data: staff }] = await Promise.all([
    query.returns<CaseRow[]>(),
    supabase.from('case_time').select('started_at, ended_at').eq('staff_id', user.id)
      .or(`started_at.gte.${todayStart},ended_at.is.null`).returns<Pick<TimeRow, 'started_at' | 'ended_at'>[]>(),
    supabase.rpc('admin_staff'),
  ]);
  const all = cases ?? [];

  // Hledání podle čísla případu, e-mailu nebo přezdívky.
  const term = q.trim();
  let matchIds: Set<string> | null = null;
  let matchNumber: number | null = null;
  if (term) {
    const n = /^(?:p-?)?0*(\d+)$/i.exec(term);
    if (n) matchNumber = Number(n[1]);
    else {
      const { data: found } = await supabase.rpc('admin_find_users', { p_q: term });
      matchIds = new Set(((found ?? []) as Array<{ id: string }>).map((u) => u.id));
    }
  }
  const rows = all.filter((c) => {
    if (matchNumber !== null) return c.number === matchNumber;
    if (matchIds) return (c.user_id && matchIds.has(c.user_id)) || (c.other_id && matchIds.has(c.other_id))
      || (c.contact_email ?? '').toLowerCase().includes(term.toLowerCase());
    if (f === '') return c.assignee_id === user.id || !c.assignee_id;
    if (f === 'report' || f === 'question' || f === 'appeal') return c.kind === f;
    return true;
  });

  const ids = [...new Set(rows.flatMap((c) => [c.user_id]).filter((x): x is string => !!x))];
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] };
  const names = new Map<string, string>((people ?? []).map((p) => [p.id as string, p.display_name as string]));
  const staffNames = new Map(((staff ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name.split(' ')[0]]));

  const open = all.filter((c) => c.status !== 'resolved');
  const late = open.filter((c) => dueGroup(c, now) === 'late').length;
  const today = open.filter((c) => dueGroup(c, now) === 'today').length;
  const unassigned = open.filter((c) => c.status === 'open' && !c.assignee_id).length;
  const waiting = open.filter((c) => c.status === 'waiting').length;
  const myToday = (time ?? []).reduce((s, t) => s + minutesOf({ started_at: t.started_at < todayStart ? todayStart : t.started_at, ended_at: t.ended_at }), 0);

  const groups = ORDER.map((g) => ({
    g,
    rows: rows.filter((c) => dueGroup(c, now) === g)
      .sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9') || PRIO_RANK[a.priority] - PRIO_RANK[b.priority]),
  })).filter((x) => x.rows.length);

  const href = (id: string) => (id ? `/sprava/podpora?f=${id}` : '/sprava/podpora');

  return (
    <div className={styles.page}>
      <AutoRefresh />
      <div className={styles.head}>
        <h1 className="t-heading-l">Podpora</h1>
        <Link href="/sprava/hlaseni?vse=1" className={styles.link}>Všechna hlášení</Link>
        <ButtonLink href="/sprava/podpora/novy">Nový případ</ButtonLink>
      </div>

      <div className={styles.tiles}>
        <Link href="/sprava/podpora?f=vse" className={`${styles.tile} ${late ? styles.tileWarn : ''}`}><span>Po termínu</span><span className={styles.tileNum}>{late}</span></Link>
        <Link href="/sprava/podpora?f=vse" className={styles.tile}><span>Termín dnes</span><span className={styles.tileNum}>{today}</span></Link>
        <Link href="/sprava/podpora" className={styles.tile}><span>Nepřiřazené</span><span className={styles.tileNum}>{unassigned}</span></Link>
        <Link href="/sprava/podpora?f=vse" className={styles.tile}><span>Čeká na uživatele</span><span className={styles.tileNum}>{waiting}</span></Link>
        <Link href="/sprava/podpora/vykaz" className={styles.tile}><span>Váš čas dnes</span><span className={styles.tileNum}>{hmLong(myToday)}</span></Link>
      </div>

      <div className={styles.filters}>
        {FILTERS.map((x) => <ChipLink key={x.id} href={href(x.id)} selected={!term && f === x.id}>{x.label}</ChipLink>)}
        <form className={styles.search} action="/sprava/podpora">
          <SearchField name="q" defaultValue={q} placeholder="Číslo, e-mail nebo přezdívka" label="Hledat případ" />
        </form>
      </div>

      <div className={styles.queue}>
        <div className={styles.qhead} aria-hidden="true">
          <span>PRIORITA</span><span>ČÍSLO</span><span>PŘEDMĚT</span><span>TYP</span><span>UŽIVATEL</span><span>ŘEŠÍ</span><span>TERMÍN</span>
        </div>
        {groups.map(({ g, rows: list }) => (
          <section key={g} aria-label={GROUP_LABEL[g]}>
            <div className={`${styles.qgroup} ${g === 'late' ? styles.qgroupLate : ''}`}>{GROUP_LABEL[g]} · {list.length}</div>
            {list.map((c) => (
              <Link key={c.id} href={`/sprava/podpora/${c.number}`} className={styles.qrow}>
                <span><span className={`${styles.prio} ${styles[`prio-${c.priority}`]}`}>{PRIORITY[c.priority]}</span></span>
                <span className="code">{caseCode(c.number)}</span>
                <span className={styles.qsubject}>
                  <strong>{c.subject}</strong>
                  {c.last_event ? <span className={styles.qmuted}>{c.last_event}</span> : null}
                </span>
                <span className={styles.qmuted}>{KIND[c.kind]}</span>
                <span className={styles.qmuted}>{(c.user_id && names.get(c.user_id)) || c.contact_email || '–'}</span>
                <span className={styles.qmuted}>{(c.assignee_id && staffNames.get(c.assignee_id)) || 'nepřiřazeno'}</span>
                <span className={g === 'late' ? styles.late : styles.qmuted}>
                  {c.status === 'resolved' ? (c.resolved_at ? dueText(c.resolved_at, now) : '') : c.due_at ? dueText(c.due_at, now) : '–'}
                </span>
              </Link>
            ))}
          </section>
        ))}
        {!groups.length ? <p className={styles.empty}>{term ? 'Nic jsme nenašli.' : 'Fronta je prázdná.'}</p> : null}
      </div>
    </div>
  );
}
