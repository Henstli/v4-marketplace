import type { Metadata } from 'next';
import Link from 'next/link';
import { addDays, caseCode, hm, hmLong, KIND, weekFrom } from '@/lib/support';
import { loadWeek } from './data';
import styles from '../podpora.module.css';

export const metadata: Metadata = { title: 'Výkaz času · podpora' };

type Props = { searchParams: Promise<{ od?: string }> };

const DAY_NAMES = ['PO', 'ÚT', 'ST', 'ČT', 'PÁ', 'SO', 'NE'];
const short = (day: string) => { const [, m, d] = day.split('-').map(Number); return `${d}. ${m}.`; };

/** Výkaz času podpory po týdnech (DS Support, Výkaz času). */
export default async function TimeReportPage({ searchParams }: Props) {
  const { od } = await searchParams;
  const monday = weekFrom(od);
  const { report } = await loadWeek(monday);
  const max = Math.max(1, ...report.kinds.map((k) => k.minutes));
  const total = report.people.reduce((s, p) => s + p.total, 0);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className="t-heading-l">Výkaz času</h1>
        <div className={styles.week}>
          <Link href={`/sprava/podpora/vykaz?od=${addDays(monday, -7)}`} aria-label="Předchozí týden">‹</Link>
          <strong>{short(monday)} – {short(addDays(monday, 6))} {monday.slice(0, 4)}</strong>
          <Link href={`/sprava/podpora/vykaz?od=${addDays(monday, 7)}`} aria-label="Další týden">›</Link>
        </div>
        <a href={`/sprava/podpora/vykaz/csv?od=${monday}`} className="tz-btn tz-btn-ghost tz-btn-md" download>Stáhnout CSV</a>
      </div>

      <div className={`${styles.box} ${styles.tableWrap}`}>
        <table className={styles.table}>
          <thead>
            <tr><th>KDO</th>{DAY_NAMES.map((d) => <th key={d} className={styles.num}>{d}</th>)}<th className={styles.num}>CELKEM</th></tr>
          </thead>
          <tbody>
            {report.people.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.name}</strong></td>
                {p.days.map((m, i) => <td key={i} className={`${styles.num} ${m ? '' : styles.dash}`}>{m ? hm(m) : '–'}</td>)}
                <td className={styles.num}><strong>{hm(p.total)}</strong></td>
              </tr>
            ))}
            {!report.people.length ? <tr><td colSpan={9} className={styles.dash}>Tento týden žádný zapsaný čas.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className={styles.cols}>
        <section className={styles.box}>
          <h2 className={styles.boxTitle}>PODLE TYPU PRÁCE</h2>
          <div className={styles.bars}>
            {report.kinds.map((k) => (
              <div key={k.kind} className={styles.bar2}>
                <span><span>{KIND[k.kind]}</span><span className="code">{hm(k.minutes)}</span></span>
                <span className={styles.track}><span className={styles.fill} style={{ width: `${(k.minutes / max) * 100}%` }} /></span>
              </div>
            ))}
          </div>
          <p className={styles.small}>
            Celkem {hmLong(total)}
            {report.resolved ? ` · průměr na vyřešený případ ${hmLong(report.avgPerResolved)} · vyřešeno ${report.resolved}` : ''}
          </p>
        </section>
        <section className={styles.box}>
          <h2 className={styles.boxTitle}>NEJNÁROČNĚJŠÍ PŘÍPADY TÝDNE</h2>
          <ul className={styles.list}>
            {report.top.map((c) => (
              <li key={c.number}>
                <Link href={`/sprava/podpora/${c.number}`} className={styles.caseLink}>
                  <span><span className="code">{caseCode(c.number)}</span> · {c.subject}</span>
                  <span className={styles.qmuted}>{c.who} · {hm(c.minutes)}</span>
                </Link>
              </li>
            ))}
            {!report.top.length ? <li className={styles.small}>Nic.</li> : null}
          </ul>
        </section>
      </div>
    </div>
  );
}
