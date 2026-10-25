import Link from 'next/link';
import styles from './site.module.css';

// Provizorní logo podle design systému: monogram V4 do doby, než bude finální název.
export function Logo() {
  return (
    <Link href="/" className={styles.logo} aria-label="V4market, domů">
      <span className={styles.monogram} aria-hidden="true">V4</span>
      <span className={styles.wordmark}>V4market</span>
    </Link>
  );
}
