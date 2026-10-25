'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface ProfileState {
  error?: string;
  ok?: boolean;
}

export async function updateProfile(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Nejste přihlášeni.' };

  const displayName = String(form.get('displayName') ?? '').trim();
  const kind = String(form.get('kind') ?? '');
  const country = String(form.get('country') ?? '');
  if (displayName.length < 2 || displayName.length > 40) return { error: 'Jméno musí mít 2 až 40 znaků.' };
  if (!['private', 'shop'].includes(kind)) return { error: 'Vyberte typ prodejce.' };
  if (!['CZ', 'SK'].includes(country)) return { error: 'Vyberte zemi.' };

  const { error } = await supabase.from('profiles').update({ display_name: displayName, kind, country }).eq('id', auth.user.id);
  if (error) return { error: 'Profil se nepodařilo uložit.' };
  revalidatePath('/', 'layout');
  return { ok: true };
}
