'use server';

import { redirect } from 'next/navigation';
import { afterLogin, authErrorMessage, safeNext } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';

export interface VerifyState {
  error?: string;
}

/** Druhý krok přihlášení: kód z ověřovací aplikace. */
export async function verifyMfa(_prev: VerifyState, form: FormData): Promise<VerifyState> {
  const code = String(form.get('code') ?? '').replace(/\s/g, '');
  const next = safeNext(form.get('dalsi'));
  if (!/^\d{6}$/.test(code)) return { error: 'Zadejte šestimístný kód z aplikace.' };

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp[0];
  if (!factor) redirect(next);
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: authErrorMessage(error) };
  redirect(afterLogin(next));
}
