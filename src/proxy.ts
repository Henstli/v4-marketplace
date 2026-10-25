import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured, SUPABASE_KEY, SUPABASE_URL } from '@/lib/supabase/config';

// Stránky, které jdou otevřít i před dokončením dvoufázového ověření.
const MFA_EXEMPT = ['/prihlaseni/overeni', '/auth/'];

// Obnoví přihlášení (cookie se session) při každém požadavku a pošle na druhý krok ověření,
// kdo má zapnuté dvoufázové ověření a zatím zadal jen heslo.
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
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (data.user && !MFA_EXEMPT.some((p) => path.startsWith(p))) {
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
