'use server';

import { revalidatePath } from 'next/cache';
import { authErrorMessage } from '@/lib/auth-helpers';
import { verifyIdentity } from '@/lib/identity';
import { normalizeAccount } from '@/lib/payment';
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

/** Doprava a bankovní účet prodejce (kupující platí přímo na něj). */
export async function updateSellerTerms(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Nejste přihlášeni.' };

  const shipping = Number(form.get('shipping'));
  const freeRaw = String(form.get('freeFrom') ?? '').trim();
  const freeFrom = freeRaw ? Number(freeRaw) : null;
  const pickup = form.get('pickup') === 'on';
  const pickupPlace = String(form.get('pickupPlace') ?? '').trim().slice(0, 60);
  if (!Number.isInteger(shipping) || shipping < 0 || shipping > 1000) return { error: 'Cena dopravy musí být 0 až 1 000 Kč.' };
  if (freeFrom !== null && (!Number.isInteger(freeFrom) || freeFrom < 1 || freeFrom > 100000)) return { error: 'Doprava zdarma od: zadejte celou částku v Kč, nebo nechte prázdné.' };
  if (pickup && pickupPlace.length < 2) return { error: 'U osobního předání napište místo (např. Praha 4).' };

  const accountRaw = String(form.get('account') ?? '').trim();
  const accountName = String(form.get('accountName') ?? '').trim();
  const iban = accountRaw ? normalizeAccount(accountRaw) : null;
  if (accountRaw && !iban) return { error: 'Číslo účtu není platné. Zadejte ho jako 123456789/0800 nebo jako IBAN.' };
  if (iban && (accountName.length < 2 || accountName.length > 70)) return { error: 'Vyplňte jméno majitele účtu.' };

  const { error } = await supabase.from('profiles')
    .update({ shipping_czk: shipping, free_shipping_from: freeFrom, pickup, pickup_place: pickup ? pickupPlace : null })
    .eq('id', auth.user.id);
  if (error) return { error: 'Nastavení se nepodařilo uložit.' };

  const { error: payError } = iban
    ? await supabase.from('seller_payment').upsert({ user_id: auth.user.id, iban, account_name: accountName, updated_at: new Date().toISOString() })
    : await supabase.from('seller_payment').delete().eq('user_id', auth.user.id);
  if (payError) return { error: 'Účet se nepodařilo uložit.' };

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
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'V4cards', friendlyName: 'Ověřovací aplikace' });
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
  revalidatePath('/ucet', 'layout');
  return { done: 'enabled' };
}

/** Vypnutí dvoufázového ověření: pro jistotu chce aktuální kód z aplikace. */
export async function disableMfa(_prev: MfaState, form: FormData): Promise<MfaState> {
  const code = String(form.get('code') ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return { error: 'Zadejte šestimístný kód z aplikace.' };
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp[0];
  if (factor) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (error) return { error: authErrorMessage(error) };
  }
  for (const f of factors?.totp ?? []) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) return { error: authErrorMessage(error) };
  }
  await supabase.auth.refreshSession();
  revalidatePath('/ucet', 'layout');
  return { done: 'disabled' };
}

export interface EmailChangeState {
  error?: string;
  sentTo?: string;
}

/** Změna e-mailu: potvrdí se heslem nebo kódem a pak odkazem z e-mailu. */
export async function changeEmail(_prev: EmailChangeState, form: FormData): Promise<EmailChangeState> {
  const newEmail = String(form.get('newEmail') ?? '').trim().toLowerCase();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) return { error: 'Nejste přihlášeni.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return { error: 'Zadejte platný e-mail.' };
  if (newEmail === auth.user.email.toLowerCase()) return { error: 'Tohle je váš současný e-mail.' };

  const problem = await verifyIdentity(supabase, auth.user.email, form);
  if (problem) return { error: problem };
  const { error } = await supabase.auth.updateUser({ email: newEmail });
  if (error) return { error: authErrorMessage(error) };
  return { sentTo: newEmail };
}
