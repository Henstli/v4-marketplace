import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import type { createClient } from './supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Náhodný token zařízení (v databázi je jen jeho otisk). */
const DEVICE_COOKIE = 'v4_zarizeni';
/** E-mail rozpracovaného přihlášení, na který jsme poslali kód. */
export const PENDING_LOGIN_COOKIE = 'v4_prihlaseni';

const secure = process.env.NODE_ENV === 'production';

export async function isTrustedDevice(supabase: Supabase): Promise<boolean> {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!token) return false;
  const { data } = await supabase.rpc('is_trusted_device', { token });
  return data === true;
}

/** Zapamatuje si toto zařízení. Volat hned po ověření kódem nebo odkazem z e-mailu. */
export async function trustThisDevice(supabase: Supabase): Promise<void> {
  const store = await cookies();
  const token = store.get(DEVICE_COOKIE)?.value ?? randomBytes(32).toString('hex');
  const label = (await headers()).get('user-agent') ?? null;
  const { error } = await supabase.rpc('trust_device', { token, device_label: label });
  if (error) return;
  store.set(DEVICE_COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
}

export async function setPendingLogin(email: string): Promise<void> {
  (await cookies()).set(PENDING_LOGIN_COOKIE, email, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 15 * 60 });
}

export async function getPendingLogin(): Promise<string | null> {
  return (await cookies()).get(PENDING_LOGIN_COOKIE)?.value ?? null;
}

export async function clearPendingLogin(): Promise<void> {
  (await cookies()).delete(PENDING_LOGIN_COOKIE);
}
