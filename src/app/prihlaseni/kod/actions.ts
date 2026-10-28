'use server';

import { redirect } from 'next/navigation';
import { afterLogin, authErrorMessage, safeNext } from '@/lib/auth-helpers';
import { clearPendingLogin, getPendingLogin, trustThisDevice } from '@/lib/devices';
import { createClient } from '@/lib/supabase/server';

export interface LoginCodeState {
  error?: string;
  resent?: boolean;
}

/** Druhý krok přihlášení z nového zařízení: kód, který přišel e-mailem. */
export async function verifyLoginCode(_prev: LoginCodeState, form: FormData): Promise<LoginCodeState> {
  const email = await getPendingLogin();
  const next = safeNext(form.get('dalsi'));
  if (!email) redirect(`/prihlaseni?dalsi=${encodeURIComponent(next)}`);
  const code = String(form.get('code') ?? '').replace(/\s/g, '');
  if (!/^\d{6,10}$/.test(code)) return { error: 'Zadejte kód z e-mailu.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) return { error: error.code === 'otp_expired' ? authErrorMessage(error) : 'Kód nesedí. Zkontrolujte ho a zkuste znovu.' };
  await trustThisDevice(supabase);
  await clearPendingLogin();
  redirect(afterLogin(next));
}

export async function resendLoginCode(): Promise<LoginCodeState> {
  const email = await getPendingLogin();
  if (!email) return { error: 'Přihlášení vypršelo. Zadejte prosím znovu e-mail a heslo.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) return { error: authErrorMessage(error) };
  return { resent: true };
}
