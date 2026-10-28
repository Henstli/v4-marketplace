import Link from 'next/link';
import { reportCode } from '@/lib/reports';
import styles from './reports.module.css';

/** Řádek na objednávce a bublině v chatu, dokud hlášení běží (DS Reports › Nahlásit problém). */
export function ReportStrip({ number }: { number: number }) {
  return (
    <div className={styles.strip} data-stay>
      <Link href={`/ucet/hlaseni/${number}`} className={styles.pill}>Hlášení {reportCode(number)}</Link>
      <span className={styles.stripText}>Objednávku prošetřujeme</span>
    </div>
  );
}
