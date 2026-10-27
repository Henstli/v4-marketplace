import Link from 'next/link';
import { Suspense } from 'react';
import { ButtonLink } from '@/components/trezor';
import { SearchBox } from '@/components/search/SearchBox';
import { GAMES } from '@/lib/games';
import { CartLink } from '@/components/cart/CartLink';
import { getSignedInUser } from '@/lib/auth';
import { HeaderAccount, HeaderAccountFallback } from '@/components/account/AccountShell';
import { MessagesLink } from '@/components/messages/MessagesLink';
import { unreadCount } from '@/app/zpravy/actions';
import { Logo } from './Logo';
import styles from './site.module.css';

export async function SiteHeader() {
  const user = await getSignedInUser();
  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerRow}`}>
        <Logo />
        <SearchBox className={styles.search} placeholder="Karta, sada, hráč nebo prodejce" label="Hledat karty, sady a prodejce" shortcut groups />
        <nav className={styles.actions} aria-label="Účet">
          <ButtonLink href="/prodat" variant="ghost">Prodat</ButtonLink>
          {user ? (
            <Suspense fallback={<MessagesLink initial={0} />}>
              <HeaderMessages />
            </Suspense>
          ) : null}
          <CartLink />
          {user ? (
            <Suspense fallback={<HeaderAccountFallback />}>
              <HeaderAccount />
            </Suspense>
          ) : (
            <ButtonLink href="/prihlaseni">Přihlásit</ButtonLink>
          )}
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

async function HeaderMessages() {
  return <MessagesLink initial={await unreadCount()} />;
}
