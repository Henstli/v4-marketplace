import Link from 'next/link';
import { Logo } from './Logo';
import styles from './site.module.css';

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.footerRow}`}>
        <Logo />
        <div className={styles.footerText}>
          <p className="t-small muted">
            <Link href="/obchodni-podminky">Obchodní podmínky</Link> · <Link href="/ochrana-osobnich-udaju">Ochrana osobních údajů</Link> · <Link href="/podpora">Napsat podpoře</Link> · <a href="mailto:podpora@v4cards.com">podpora@v4cards.com</a> · <Link href="/nahlasit">Nahlásit nezákonný obsah</Link> · Beta verze
          </p>
          <p className="t-small muted">
            Inzerce sběratelských karet pro Česko a Slovensko. Platíte přímo prodejci.
          </p>
        </div>
      </div>
    </footer>
  );
}
