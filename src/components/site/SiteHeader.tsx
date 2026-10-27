import Link from 'next/link';
import { ButtonLink } from '@/components/trezor';
import { SearchBox } from '@/components/search/SearchBox';
import { GAMES } from '@/lib/games';
import { HeaderUser } from './HeaderUser';
import { Logo } from './Logo';
import styles from './site.module.css';

// Hlavička je pro všechny stejná (přihlášení doplní HeaderUser v prohlížeči), takže nečte cookies
// a veřejné stránky můžou jít z mezipaměti.
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerRow}`}>
        <Logo />
        <SearchBox className={styles.search} placeholder="Karta, sada, hráč nebo prodejce" label="Hledat karty, sady a prodejce" shortcut groups />
        <nav className={styles.actions} aria-label="Účet">
          <ButtonLink href="/prodat" variant="secondary">Prodat</ButtonLink>
          <HeaderUser />
        </nav>
      </div>
      <nav className={`container ${styles.games}`} aria-label="Kategorie">
        {GAMES.map((g) =>
          g.live ? (
            <Link key={g.id} href={`/karty?hra=${g.id}`} className={styles.gameLink}>
              <span className="tz-chip-dot" style={{ background: g.dot }} aria-hidden="true" />
              {g.name}
            </Link>
          ) : (
            <span key={g.id} className={styles.gameSoon}>
              <span className="tz-chip-dot" style={{ background: g.dot }} aria-hidden="true" />
              {g.name}
              <span className={styles.soonTag}>Brzy</span>
            </span>
          ),
        )}
      </nav>
    </header>
  );
}

