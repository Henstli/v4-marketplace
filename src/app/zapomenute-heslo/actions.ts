'use server';

import { authErrorMessage, siteOrigin } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';

export interface ForgotState {
  error?: string;
  sentTo?: string;
}

export async function sendResetLink(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  const email = String(form.get('email') ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Zadejte platný e-mail.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteOrigin()}/auth/callback?dalsi=/nove-heslo`,
  });
  if (error && error.code !== 'user_not_found') return { error: authErrorMessage(error) };
  return { sentTo: email };
}
