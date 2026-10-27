import type { ReactNode } from 'react';
import { getAccountSummary } from '@/lib/account';
import { AccountSide } from './AccountNav';

/** Centrum účtu: boční navigace Můj profil kolem stránky. Nepřihlášené přesměruje sama stránka. */
export async function AccountShell({ children }: { children: ReactNode }) {
  const a = await getAccountSummary();
  return a ? <AccountSide a={a}>{children}</AccountSide> : <>{children}</>;
}
