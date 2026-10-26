import Link from 'next/link';
import type { ReactNode } from 'react';
import { getAccountSummary } from '@/lib/account';
import { AccountMenu, AccountSide, Icon } from './AccountNav';

/** Centrum účtu: boční navigace Můj profil kolem stránky. Nepřihlášené přesměruje sama stránka. */
export async function AccountShell({ children }: { children: ReactNode }) {
  const a = await getAccountSummary();
  return a ? <AccountSide a={a}>{children}</AccountSide> : <>{children}</>;
}

/** Menu Můj profil v hlavičce; načítá se souběžně se stránkou (Suspense). */
export async function HeaderAccount() {
  const a = await getAccountSummary();
  return a ? <AccountMenu a={a} /> : <HeaderAccountFallback />;
}

export function HeaderAccountFallback() {
  return (
    <Link href="/ucet" className="tz-acct-btn" aria-label="Můj profil">
      <span className="tz-shop-logo" style={{ width: 32, height: 32, background: 'var(--line)' }} aria-hidden="true" />
      <span className="tz-acct-label">Můj profil</span>
      <Icon name="down" size={16} />
    </Link>
  );
}
