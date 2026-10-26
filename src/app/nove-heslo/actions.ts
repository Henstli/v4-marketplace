'use server';

import { redirect } from 'next/navigation';
import { authErrorMessage, checkPassword } from '@/lib/auth-helpers';
import { identityMethod, verifyIdentity } from '@/lib/identity';
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
  if (password !== String(form.get('passwordConfirm') ?? '')) return { error: 'Nová hesla se neshodují.' };

  const { data: recovery } = await supabase.rpc('recent_password_recovery');
  if (recovery !== true) {
    if ((await identityMethod(supabase)) === 'password') {
      // Současné heslo hlídá i databáze.
      const { data: problem, error: checkError } = await supabase.rpc('check_password_change', { current_password: current });
      if (checkError) return { error: authErrorMessage(null) };
      if (problem === 'current_required') return { error: 'Zadejte současné heslo.' };
      if (problem === 'current_wrong') return { error: 'Současné heslo nesedí.' };
      if (current === password) return { error: 'Nové heslo musí být jiné než současné.' };
    } else {
      // Účet bez hesla (přes Google): první heslo potvrdí kódem z aplikace nebo z e-mailu.
      const problem = await verifyIdentity(supabase, auth.user.email ?? '', form);
      if (problem) return { error: problem };
    }
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: authErrorMessage(error) };
  redirect('/ucet/nastaveni?heslo=zmeneno');
}
