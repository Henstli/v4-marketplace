'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/auth-helpers';
import { getCurrentUser } from '@/lib/auth';

// Stejný název čte rozcestník (page.tsx).
const MODE_COOKIE = 'v4-rezim';

/** Volba po přihlášení: web, nebo podpora (jen pro správce). „Pamatovat si“ platí na tomto počítači rok. */
export async function chooseMode(form: FormData) {
  const next = safeNext(form.get('dalsi'));
  const mode = form.get('mode') === 'podpora' ? 'podpora' : 'web';
  const user = await getCurrentUser();
  if (form.get('remember')) {
    (await cookies()).set(MODE_COOKIE, mode, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: true, secure: true });
  }
  redirect(mode === 'podpora' && user?.isStaff ? '/sprava/podpora' : next);
}
