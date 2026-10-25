'use server';

import { redirect } from 'next/navigation';
import { authErrorMessage, checkPassword } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';

export interface NewPasswordState {
  error?: string;
}

export async function setNewPassword(_prev: NewPasswordState, form: FormData): Promise<NewPasswordState> {
  const password = String(form.get('password') ?? '');
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Odkaz vypršel. Požádejte prosím o nový.' };
  const weak = checkPassword(password, auth.user.email);
  if (weak) return { error: weak };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: authErrorMessage(error) };
  redirect('/ucet?heslo=zmeneno');
}
