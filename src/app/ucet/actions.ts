'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { authErrorMessage } from '@/lib/auth-helpers';
import { verifyIdentity } from '@/lib/identity';
import { normalizeAccount } from '@/lib/payment';
import { CARRIERS, type Carrier } from '@/lib/delivery';
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

/** Doprava a platba prodejce (DS DeliveryPayment). Kupující platí přímo prodejci. */
export async function updateDeliveryPayment(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Nejste přihlášeni.' };
  const me = auth.user.id;

  const transfer = form.get('transfer') === 'on';
  const cash = form.get('cash') === 'on';
  const pickup = form.get('pickup') === 'on';
  const pickupPlace = String(form.get('pickupPlace') ?? '').trim().slice(0, 60);
  const radius = Number(form.get('radius') ?? 2);
  const lat = Number(form.get('lat'));
  const lng = Number(form.get('lng'));
  const hasPos = pickup && String(form.get('lat') ?? '') !== '' && Number.isFinite(lat) && Number.isFinite(lng);
  const freeRaw = String(form.get('freeFrom') ?? '').trim();
  const freeFrom = freeRaw ? Number(freeRaw) : null;
  if (pickup && pickupPlace.length < 2) return { error: 'U osobního předání napište místo (např. Brno, Mendlovo náměstí).' };
  if (pickup && (!Number.isInteger(radius) || radius < 1 || radius > 50)) return { error: 'Okruh předání musí být 1 až 50 km.' };
  if (cash && !pickup) return { error: 'Platba hotově jde jen s osobním předáním. Zapněte ho, nebo hotovost vypněte.' };
  if (freeFrom !== null && (!Number.isInteger(freeFrom) || freeFrom < 1 || freeFrom > 100000)) return { error: 'Doprava zdarma od: zadejte celou částku v Kč, nebo nechte prázdné.' };

  const accountRaw = String(form.get('account') ?? '').trim();
  const accountName = String(form.get('accountName') ?? '').trim();
  const iban = transfer && accountRaw ? normalizeAccount(accountRaw) : null;
  if (transfer && !iban) return { error: 'Číslo účtu není platné. Zadejte ho jako 123456789/0800 nebo jako IBAN.' };
  if (iban && (accountName.length < 2 || accountName.length > 70)) return { error: 'Vyplňte jméno majitele účtu.' };

  const methods: Array<{ seller_id: string; carrier: Carrier; label: string | null; price_czk: number; cod: boolean; cod_fee_czk: number }> = [];
  for (const c of CARRIERS) {
    if (form.get(`c_${c.key}`) !== 'on') continue;
    const price = Number(form.get(`p_${c.key}`));
    const cod = form.get(`cod_${c.key}`) === 'on';
    const fee = cod ? Number(form.get(`fee_${c.key}`) ?? 0) : 0;
    const label = c.key === 'custom' ? String(form.get('label_custom') ?? '').trim().slice(0, 40) : null;
    if (!Number.isInteger(price) || price < 0 || price > 1000) return { error: `${c.name}: cena musí být 0 až 1 000 Kč.` };
    if (!Number.isInteger(fee) || fee < 0 || fee > 500) return { error: `${c.name}: příplatek za dobírku musí být 0 až 500 Kč.` };
    if (c.key === 'custom' && (!label || label.length < 2)) return { error: 'Napište název vlastního způsobu dopravy.' };
    methods.push({ seller_id: me, carrier: c.key, label, price_czk: price, cod, cod_fee_czk: fee });
  }

  // Polohu zaokrouhlíme na ~1 km: profil je veřejný, přesná adresa do něj nepatří.
  const round = (x: number) => Math.round(x * 100) / 100;
  const { error } = await supabase.from('profiles').update({
    pay_transfer: transfer,
    cash_on_pickup: cash,
    pickup,
    pickup_place: pickup ? pickupPlace : null,
    pickup_lat: hasPos ? round(lat) : null,
    pickup_lng: hasPos ? round(lng) : null,
    pickup_radius_km: pickup ? radius : null,
    free_shipping_from: freeFrom,
  }).eq('id', me);
  if (error) return { error: 'Nastavení se nepodařilo uložit.' };

  if (iban) {
    const { error: payError } = await supabase.from('seller_payment').upsert({ user_id: me, iban, account_name: accountName, updated_at: new Date().toISOString() });
    if (payError) return { error: 'Účet se nepodařilo uložit.' };
  }

  const keep = methods.map((m) => m.carrier);
  const del = supabase.from('seller_shipping_methods').delete().eq('seller_id', me);
  const { error: delError } = keep.length ? await del.not('carrier', 'in', `(${keep.join(',')})`) : await del;
  if (delError) return { error: 'Dopravu se nepodařilo uložit.' };
  if (methods.length) {
    const { error: shipError } = await supabase.from('seller_shipping_methods').upsert(methods);
    if (shipError) return { error: 'Dopravu se nepodařilo uložit.' };
  }

  revalidatePath('/', 'layout');
  const back = String(form.get('back') ?? '');
  if (back.startsWith('/') && !back.startsWith('//')) redirect(back);
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
