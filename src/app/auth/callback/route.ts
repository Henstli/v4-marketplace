import { NextResponse, type NextRequest } from 'next/server';
import { afterLogin, safeNext } from '@/lib/auth-helpers';
import { sendWelcomeEmail } from '@/lib/email';
import { createClient } from '@/lib/supabase/server';

// Sem se vrací přihlášení přes Google (a starší odkazy z e-mailů; nové vedou na /auth/confirm).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('dalsi'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await sendWelcomeEmail(supabase, origin);
      return NextResponse.redirect(`${origin}${afterLogin(next)}`);
    }
  }
  return NextResponse.redirect(`${origin}/prihlaseni?chyba=odkaz`);
}
