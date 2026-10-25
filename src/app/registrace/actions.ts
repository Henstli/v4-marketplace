'use server';

import { authErrorMessage, checkPassword, safeNext, siteOrigin } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';

export interface SignupState {
  error?: string;
  sentTo?: string;
}

export async function signUp(_prev: SignupState, form: FormData): Promise<SignupState> {
  const displayName = String(form.get('displayName') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const next = safeNext(form.get('dalsi'));

  if (displayName.length < 2 || displayName.length > 40) return { error: 'Přezdívka musí mít 2 až 40 znaků.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Zadejte platný e-mail.' };
  const weak = checkPassword(password, email);
  if (weak) return { error: weak };
  if (form.get('terms') !== 'on') return { error: 'Pro registraci je potřeba souhlas s podmínkami.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: `${await siteOrigin()}/auth/callback?dalsi=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: authErrorMessage(error) };
  // Supabase z bezpečnostních důvodů neprozradí, jestli e-mail už má účet; zpráva je proto stejná.
  return { sentTo: email };
}
