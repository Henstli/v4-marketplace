import { authErrorMessage } from './auth-helpers';
import type { createClient } from './supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Jak člověk potvrdí citlivou změnu (změna e-mailu, první heslo u účtu z Googlu):
 * současným heslem, kódem z ověřovací aplikace, nebo kódem z e-mailu.
 */
export type IdentityMethod = 'password' | 'totp' | 'email';

export async function identityMethod(supabase: Supabase): Promise<IdentityMethod> {
  const [{ data: hasPassword }, { data: factors }] = await Promise.all([
    supabase.rpc('has_password'),
    supabase.auth.mfa.listFactors(),
  ]);
  if (hasPassword === true) return 'password';
  if ((factors?.totp.length ?? 0) > 0) return 'totp';
  return 'email';
}

/** Ověří heslo nebo kód z formuláře (pole currentPassword / identityCode). Vrací chybu, nebo null. */
export async function verifyIdentity(supabase: Supabase, email: string, form: FormData): Promise<string | null> {
  const method = await identityMethod(supabase);
  if (method === 'password') {
    const current = String(form.get('currentPassword') ?? '');
    if (!current) return 'Zadejte současné heslo.';
    const { data } = await supabase.rpc('verify_current_password', { current_password: current });
    return data === true ? null : 'Současné heslo nesedí.';
  }

  const code = String(form.get('identityCode') ?? '').replace(/\s/g, '');
  if (!/^\d{6,10}$/.test(code)) return method === 'totp' ? 'Zadejte kód z ověřovací aplikace.' : 'Zadejte kód z e-mailu.';
  if (method === 'totp') {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp[0];
    if (!factor) return authErrorMessage(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    return error ? authErrorMessage(error) : null;
  }
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  return error ? 'Kód nesedí nebo už vypršel. Pošlete si nový.' : null;
}
