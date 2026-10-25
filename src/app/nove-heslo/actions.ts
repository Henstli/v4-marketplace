'use server';

import { redirect } from 'next/navigation';
import { authErrorMessage, checkPassword } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';

export interface NewPasswordState {
  error?: string;
}

export async function setNewPassword(_prev: NewPasswordState, form: FormData): Promise<NewPasswordState> {
  const current = String(form.get('currentPassword') ?? '');
  const password = String(form.get('password') ?? '');
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Odkaz vypršel. Požádejte prosím o nový.' };
  const weak = checkPassword(password, auth.user.email);
  if (weak) return { error: weak };

  // Současné heslo hlídá databáze (kromě obnovy přes e-mail a účtů bez hesla).
  const { data: problem, error: checkError } = await supabase.rpc('check_password_change', { current_password: current });
  if (checkError) return { error: authErrorMessage(null) };
  if (problem === 'current_required') return { error: 'Zadejte současné heslo.' };
  if (problem === 'current_wrong') return { error: 'Současné heslo nesedí.' };
  if (current && current === password) return { error: 'Nové heslo musí být jiné než současné.' };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: authErrorMessage(error) };
  redirect('/ucet?heslo=zmeneno');
}
