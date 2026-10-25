import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';

// Sem vede odkaz z e-mailu (ověření registrace, nové heslo) a návrat z přihlášení přes Google.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('dalsi'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/prihlaseni?chyba=odkaz`);
}
