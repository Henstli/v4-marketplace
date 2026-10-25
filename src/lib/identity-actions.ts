'use server';

import { authErrorMessage } from './auth-helpers';
import { createClient } from './supabase/server';

export interface CodeSendState {
  error?: string;
  sent?: boolean;
}

/** Pošle přihlášenému člověku kód na jeho e-mail (potvrzení citlivé změny). */
export async function sendIdentityCode(): Promise<CodeSendState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) return { error: 'Nejste přihlášeni.' };
  const { error } = await supabase.auth.signInWithOtp({ email: auth.user.email, options: { shouldCreateUser: false } });
  if (error) return { error: authErrorMessage(error) };
  return { sent: true };
}
