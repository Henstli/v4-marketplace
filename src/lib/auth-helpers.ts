import { headers } from 'next/headers';
import { SUPABASE_KEY, SUPABASE_URL } from './supabase/config';

/** Bezpečná cílová stránka po přihlášení: jen cesta na našem webu. */
export function safeNext(next: unknown): string {
  const s = typeof next === 'string' ? next : '';
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
}

/** Adresa webu pro odkazy v e-mailech a návrat z Googlu. */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get('origin');
  if (origin) return origin;
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : '';
}

export const PASSWORD_MIN = 8;

/** Kontrola hesla před odesláním do Supabase. Vrací chybu, nebo null. */
export function checkPassword(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Heslo musí mít aspoň ${PASSWORD_MIN} znaků.`;
  if (password.length > 72) return 'Heslo může mít nejvýš 72 znaků.';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'Heslo nesmí být stejné jako e-mail.';
  return null;
}

/** Srozumitelná česká hláška pro chybu ze Supabase Auth. */
export function authErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  switch (error?.code) {
    case 'invalid_credentials':
      return 'Nesprávný e-mail nebo heslo.';
    case 'email_not_confirmed':
      return 'E-mail ještě není ověřený. Klikněte na odkaz, který jsme vám poslali.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Účet s tímto e-mailem už existuje. Přihlaste se.';
    case 'weak_password':
      return 'Heslo je příliš slabé. Zvolte delší nebo méně obvyklé.';
    case 'same_password':
      return 'Nové heslo musí být jiné než současné.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Příliš mnoho pokusů. Zkuste to prosím za pár minut.';
    case 'mfa_verification_failed':
    case 'mfa_challenge_expired':
      return 'Kód nesedí nebo už vypršel. Zadejte aktuální kód z aplikace.';
    case 'insufficient_aal':
      return 'Nejdřív dokončete dvoufázové ověření.';
    case 'provider_disabled':
      return 'Tento způsob přihlášení zatím není zapnutý.';
    default:
      return 'Něco se nepovedlo. Zkuste to prosím znovu.';
  }
}

/** Které způsoby přihlášení jsou v Supabase zapnuté (Google zapíná správce v nastavení Supabase). */
export async function authProviders(): Promise<{ google: boolean }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_KEY },
      next: { revalidate: 300 },
    });
    if (!res.ok) return { google: false };
    const body = (await res.json()) as { external?: Record<string, boolean> };
    return { google: body.external?.google === true };
  } catch {
    return { google: false };
  }
}
