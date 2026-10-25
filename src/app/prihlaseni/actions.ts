'use server';

import { redirect } from 'next/navigation';
import { authErrorMessage, safeNext, siteOrigin } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';

export interface LoginState {
  error?: string;
  /** E-mail, který ještě není ověřený (nabídneme nový ověřovací odkaz) */
  unconfirmed?: string;
  resent?: boolean;
}

export async function signInWithPassword(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const next = safeNext(form.get('dalsi'));
  if (!email || !password) return { error: 'Vyplňte e-mail a heslo.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === 'email_not_confirmed') return { error: authErrorMessage(error), unconfirmed: email };
    return { error: authErrorMessage(error) };
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === 'aal1' && aal.nextLevel === 'aal2') {
    redirect(`/prihlaseni/overeni?dalsi=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function resendConfirmation(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim();
  const next = safeNext(form.get('dalsi'));
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback?dalsi=${encodeURIComponent(next)}` },
  });
  if (error) return { error: authErrorMessage(error), unconfirmed: email };
  return { resent: true, unconfirmed: email };
}

export async function signInWithGoogle(form: FormData) {
  const next = safeNext(form.get('dalsi'));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${await siteOrigin()}/auth/callback?dalsi=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect(`/prihlaseni?chyba=google`);
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
