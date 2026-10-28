import type { Metadata } from 'next';
import Link from 'next/link';
import { ChipLink } from '@/components/trezor';
import { caseCode, hm, hmLong, minutesOf, monthFrom, monthName, pragueDay, shiftMonth } from '@/lib/support';
import { fixTime } from '../actions';
import { loadMonth } from './data';
import styles from '../podpora.module.css';

export const metadata: Metadata = { title: 'Výkaz času · podpora' };

type Props = { searchParams: Promise<{ mesic?: string; kdo?: string; den?: string; ok?: string; chyba?: string }> };

const DAY = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const dayLabel = (day: string) => {
  const [, m, d] = day.split('-').map(Number);
  return `${DAY[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${d}. ${m}.`;
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/Prague' });

/** Výkaz času podpory po měsících (DS Support › Výkaz času). Čas se počítá sám, tady se jen opravuje. */
export default async function TimeReportPage({ searchParams }: Props) {
  const { mesic, kdo, den, ok, chyba } = await searchParams;
  const month = monthFrom(mesic);
  const { report, rows, names, who, admin, me } = await loadMonth(month, kdo);
  const today = pragueDay(new Date());
  const shown = den === 'dnes' ? rows.filter((t) => pragueDay(t.started_at) === today) : rows;

  const q = (p: { mesic?: string; kdo?: string | null; den?: string | null }) => {
    const sp = new URLSearchParams();
    const m = p.mesic ?? month;
    if (m !== monthFrom()) sp.set('mesic', m);
    const k = p.kdo === undefined ? who : p.kdo;
    if (k) sp.set('kdo', k);
    const d = p.den === undefined ? den : p.den;
    if (d) sp.set('den', d);
    const s = sp.toString();
    return s ? `?${s}` : '';
  };
  const self = `/sprava/podpora/vykaz${q({})}`;

  // Skupiny po dnech, nejnovější nahoře.
  const days = new Map<string, typeof shown>();
  for (const t of [...shown].reverse()) {
    const d = pragueDay(t.started_at);
    days.set(d, [...(days.get(d) ?? []), t]);
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className="t-heading-l">Výkaz času</h1>
        <div className={styles.week}>
          <Link href={`/sprava/podpora/vykaz${q({ mesic: shiftMonth(month, -1) })}`} aria-label="Předchozí měsíc">‹</Link>
          <strong className={styles.monthName}>{monthName(month)}</strong>
          <Link href={`/sprava/podpora/vykaz${q({ mesic: shiftMonth(month, 1) })}`} aria-label="Další měsíc">›</Link>
        </div>
        <a href={`/sprava/podpora/vykaz/csv?mesic=${month}${who ? `&kdo=${who}` : ''}`} className="tz-btn tz-btn-secondary tz-btn-md" download>Stáhnout CSV</a>
      </div>
      {ok ? <p className={styles.flash}>{ok}</p> : null}
      {chyba ? <p className={`${styles.flash} ${styles.flashErr}`}>{chyba}</p> : null}

      <div className={styles.tiles}>
        <div className={styles.tile}><span>Celkem za měsíc</span><span className={styles.tileNum}>{hmLong(report.total)}</span></div>
        <div className={styles.tile}><span>Vyřešené případy</span><span className={styles.tileNum}>{report.resolved}</span></div>
        <div className={styles.tile}><span>Průměr na případ</span><span className={styles.tileNum}>{report.resolved ? hmLong(report.avgPerResolved) : '–'}</span></div>
      </div>

      <div className={`${styles.box} ${styles.tableWrap}`}>
        <table className={styles.table}>
          <thead>
            <tr><th>ČLEN TÝMU</th><th className={styles.num}>NA PŘÍPADECH</th><th className={styles.num}>OSTATNÍ PRÁCE</th><th className={styles.num}>CELKEM</th><th className={styles.num}>PŘÍPADY</th></tr>
          </thead>
          <tbody>
            {report.people.map((p) => (
              <tr key={p.id}>
                <td>{admin ? <Link href={`/sprava/podpora/vykaz${q({ kdo: p.id })}`} className={styles.link}>{p.name} ›</Link> : <strong>{p.name}</strong>}</td>
                <td className={styles.num}>{hm(p.cases)}</td>
                <td className={styles.num}>{hm(p.other)}</td>
                <td className={styles.num}><strong>{hm(p.total)}</strong></td>
                <td className={styles.num}>{p.count}</td>
              </tr>
            ))}
            {!report.people.length ? <tr><td colSpan={5} className={styles.dash}>Tento měsíc žádný čas.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <section className={styles.box} aria-label="Záznamy">
        <h2 className={styles.boxTitle}>ZÁZNAMY</h2>
        <div className={styles.row}>
          {admin ? (
            <>
              <ChipLink href={`/sprava/podpora/vykaz${q({ kdo: null })}`} selected={!who}>Všichni</ChipLink>
              {[...names].map(([id, n]) => <ChipLink key={id} href={`/sprava/podpora/vykaz${q({ kdo: id })}`} selected={who === id}>{n}</ChipLink>)}
              <span className={styles.chipGap} />
            </>
          ) : null}
          <ChipLink href={`/sprava/podpora/vykaz${q({ den: null })}`} selected={den !== 'dnes'}>Celý měsíc</ChipLink>
          <ChipLink href={`/sprava/podpora/vykaz${q({ den: 'dnes' })}`} selected={den === 'dnes'}>Jen dnes</ChipLink>
        </div>
        <p className={styles.small}>Oprava: klikněte na čas · opravy se zapisují do Záznamu akcí{admin ? '' : ' · vidíte jen svůj čas'}</p>
        {[...days].map(([day, list]) => (
          <div key={day}>
            <div className={styles.dayBar}><span>{dayLabel(day)}</span><span className="code">{hm(list.reduce((s, t) => s + minutesOf(t), 0))}</span></div>
            <ul className={styles.entries}>
              {list.map((t) => {
                const c = t.support_cases;
                const canFix = t.ended_at && (t.staff_id === me || admin);
                return (
                  <li key={t.id} className={styles.entry}>
                    <span className={styles.qmuted}>{clock(t.started_at)}–{t.ended_at ? clock(t.ended_at) : 'teď'}</span>
                    <span>{names.get(t.staff_id ?? '') ?? 'smazaný účet'}</span>
                    <span className="code">{c ? <Link href={`/sprava/podpora/${c.number}`} className={styles.link}>{caseCode(c.number)}</Link> : '–'}</span>
                    <span className={styles.qmuted}>{c?.subject ?? 'Ostatní práce'}{t.auto_stopped ? ' · zastaveno samo' : ''}</span>
                    {canFix ? (
                      <details className={styles.fixTime}>
                        <summary className="code">{hm(minutesOf(t))}</summary>
                        <form action={fixTime} className={styles.fix}>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="back" value={self} />
                          <input className={styles.input} type="number" name="minutes" min={0} max={600} defaultValue={Math.round(minutesOf(t))} aria-label="Minut" />
                          <button type="submit" className={styles.smallBtn}>Opravit</button>
                        </form>
                      </details>
                    ) : <span className="code">{hm(minutesOf(t))}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!days.size ? <p className={styles.small}>Žádné záznamy.</p> : null}
      </section>
    </div>
  );
}
