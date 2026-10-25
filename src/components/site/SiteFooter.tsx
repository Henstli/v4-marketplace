import { Logo } from './Logo';
import styles from './site.module.css';

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.footerRow}`}>
        <Logo />
        <p className="t-small muted">
          Marketplace sběratelských karet pro Česko a Slovensko. Peníze držíme v úschově do doručení.
        </p>
        <p className="t-small muted">Beta verze · ukázková data</p>
      </div>
    </footer>
  );
}
