import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/auth-helpers';
import { trustThisDevice } from '@/lib/devices';
import { sendWelcomeEmail } from '@/lib/email';
import { createClient } from '@/lib/supabase/server';

const TYPES: EmailOtpType[] = ['email', 'signup', 'recovery', 'email_change', 'magiclink', 'invite'];

// Sem vedou odkazy z e-mailů (potvrzení registrace, obnova hesla, změna e-mailu).
// Na rozdíl od /auth/callback fungují i v jiném prohlížeči nebo na jiném zařízení, než kde o ně člověk požádal.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  if (!tokenHash || !type || !TYPES.includes(type)) return NextResponse.redirect(`${origin}/prihlaseni?chyba=odkaz`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(`${origin}/prihlaseni?chyba=odkaz`);

  // Kdo klikl na odkaz z e-mailu, prokázal přístup k e-mailu: toto zařízení už nebude chtít kód.
  await trustThisDevice(supabase);

  let next = safeNext(searchParams.get('dalsi'));
  if (type === 'recovery') next = '/nove-heslo';
  else if (type === 'email_change') next = data.user?.new_email ? '/ucet/nastaveni?email=druhy' : '/ucet/nastaveni?email=zmenen';
  else await sendWelcomeEmail(supabase, origin);
  return NextResponse.redirect(`${origin}${next}`);
}
