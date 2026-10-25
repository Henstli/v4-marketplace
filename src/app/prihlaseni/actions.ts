'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface LoginState {
  error?: string;
  sentTo?: string;
}

export async function sendLoginLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Zadejte platný e-mail.' };

  const origin = (await headers()).get('origin') ?? '';
  const next = String(form.get('dalsi') ?? '/');
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?dalsi=${encodeURIComponent(next)}` },
  });
  if (error) return { error: 'Odkaz se nepodařilo odeslat. Zkuste to prosím za chvíli.' };
  return { sentTo: email };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
