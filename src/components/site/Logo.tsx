import Link from 'next/link';
import styles from './site.module.css';

// Provizorní logo podle design systému: monogram V4 a nápis V4cards, dokud nebude vybrané finální logo.
export function Logo() {
  return (
    <Link href="/" className={styles.logo} aria-label="V4cards, domů">
      <span className={styles.monogram} aria-hidden="true">V4</span>
      <span className={styles.wordmark}>V4cards</span>
    </Link>
  );
}
