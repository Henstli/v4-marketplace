import Link from 'next/link';
import { SearchField, ButtonLink } from '@/components/trezor';
import { GAMES } from '@/lib/games';
import { CartLink } from '@/components/cart/CartLink';
import { getSignedInUser } from '@/lib/auth';
import { signOut } from '@/app/prihlaseni/actions';
import { Logo } from './Logo';
import styles from './site.module.css';

export async function SiteHeader() {
  const user = await getSignedInUser();
  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerRow}`}>
        <Logo />
        <form action="/karty" role="search" className={styles.search}>
          <SearchField name="q" placeholder="Karta, sada nebo hráč" shortcut="/" label="Hledat karty" />
        </form>
        <nav className={styles.actions} aria-label="Účet">
          <ButtonLink href="/prodat" variant="ghost">Prodat</ButtonLink>
          <CartLink />
          {user ? (
            <>
            <ButtonLink href="/objednavky" variant="ghost">Objednávky</ButtonLink>
            <ButtonLink href="/ucet" variant="ghost">Účet</ButtonLink>
            <form action={signOut}>
              <button type="submit" className="tz-btn tz-btn-ghost tz-btn-md" title={user.email}>Odhlásit</button>
            </form>
            </>
          ) : (
            <ButtonLink href="/prihlaseni">Přihlásit</ButtonLink>
          )}
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
