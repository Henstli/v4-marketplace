'use server';

import { getAccountSummary, type AccountSummary } from '@/lib/account';

/** Menu Můj profil v hlavičce: volá ho prohlížeč, stránka sama zůstává stejná pro všechny. */
export async function loadAccountSummary(): Promise<AccountSummary | null> {
  return getAccountSummary();
}
