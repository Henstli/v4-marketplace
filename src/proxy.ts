import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured, SUPABASE_KEY, SUPABASE_URL } from '@/lib/supabase/config';

// Stránky, které jdou otevřít i před dokončením dvoufázového ověření.
const MFA_EXEMPT = ['/prihlaseni/overeni', '/auth/'];

// Obnoví přihlášení (cookie se session) a pošle na druhý krok ověření, kdo má zapnuté dvoufázové
// ověření a zatím zadal jen heslo. Běží jen na stránkách za přihlášením (matcher dole): veřejné stránky
// jdou z mezipaměti a přihlášení tam obnovuje klient Supabase v prohlížeči (HeaderUser).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!isSupabaseConfigured()) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });
  // getClaims ověří token lokálně podle veřejného klíče (ES256), takže proxy nečeká na server Supabase.
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  if (data?.claims && !MFA_EXEMPT.some((p) => path.startsWith(p))) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal1' && aal.nextLevel === 'aal2') {
      const url = request.nextUrl.clone();
      url.pathname = '/prihlaseni/overeni';
      url.search = `?dalsi=${encodeURIComponent(path + request.nextUrl.search)}`;
      const redirect = NextResponse.redirect(url, 303);
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return redirect;
    }
  }
  return response;
}

export const config = {
  matcher: [
    '/ucet/:path*', '/kosik', '/objednavky/:path*', '/zpravy/:path*', '/prodat/:path*', '/sprava/:path*', '/hlidani/:path*',
    '/prihlaseni/:path*', '/registrace', '/nove-heslo', '/zapomenute-heslo', '/auth/:path*',
  ],
};
