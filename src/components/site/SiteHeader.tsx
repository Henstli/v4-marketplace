import Link from 'next/link';
import { SearchField, ButtonLink } from '@/components/trezor';
import { GAMES } from '@/lib/games';
import { Logo } from './Logo';
import styles from './site.module.css';

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerRow}`}>
        <Logo />
        <form action="/karty" role="search" className={styles.search}>
          <SearchField name="q" placeholder="Karta, sada nebo hráč" shortcut="/" label="Hledat karty" />
        </form>
        <nav className={styles.actions} aria-label="Účet">
          <ButtonLink href="/prodat" variant="ghost">Prodat</ButtonLink>
          <ButtonLink href="/kosik" variant="secondary">Košík</ButtonLink>
          <ButtonLink href="/prihlaseni">Přihlásit</ButtonLink>
        </nav>
      </div>
      <nav className={`container ${styles.games}`} aria-label="Kategorie">
        {GAMES.filter((g) => g.live).map((g) => (
          <Link key={g.id} href={`/karty?hra=${g.id}`} className={styles.gameLink}>
            <span className="tz-chip-dot" style={{ background: g.dot }} aria-hidden="true" />
            {g.name}
          </Link>
        ))}
        <span className={styles.soon}>Brzy: One Piece, Lorcana, Riftbound, Cyberpunk</span>
      </nav>
    </header>
  );
}
