'use server';

import { revalidatePath } from 'next/cache';
import { authErrorMessage } from '@/lib/auth-helpers';
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

export interface MfaState {
  error?: string;
  /** Rozpracované zapnutí: QR kód a tajný klíč pro ruční zadání */
  enroll?: { factorId: string; qr: string; secret: string };
  done?: 'enabled' | 'disabled';
}

/** Začne zapínat dvoufázové ověření: vytvoří nový faktor a vrátí QR kód pro aplikaci. */
export async function startMfa(): Promise<MfaState> {
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  // Nedokončené pokusy z dřívějška uklidíme, jinak by enroll selhal na stejném názvu.
  for (const f of factors?.all ?? []) {
    if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'V4market', friendlyName: 'Ověřovací aplikace' });
  if (error) return { error: authErrorMessage(error) };
  return { enroll: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
}

export async function confirmMfa(_prev: MfaState, form: FormData): Promise<MfaState> {
  const factorId = String(form.get('factorId') ?? '');
  const code = String(form.get('code') ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return { error: 'Zadejte šestimístný kód z aplikace.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: authErrorMessage(error) };
  revalidatePath('/ucet');
  return { done: 'enabled' };
}

export async function disableMfa(): Promise<MfaState> {
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.totp ?? []) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) return { error: authErrorMessage(error) };
  }
  await supabase.auth.refreshSession();
  revalidatePath('/ucet');
  return { done: 'disabled' };
}
