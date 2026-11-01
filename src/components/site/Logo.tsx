import Link from 'next/link';
import styles from './site.module.css';

// Logo A1 (DS Trezor › Logo): mátová dlaždice V4 s leskem a spodní hranou a nápis V4cards.
export function Logo() {
  return (
    <Link href="/" className={styles.logo} aria-label="V4cards, domů">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={36} height={36} className={styles.monogram} />
      <span className={styles.wordmark}>V4cards</span>
    </Link>
  );
}
