import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config';

// Klient bez přihlášení pro veřejná data katalogu. RLS ukazuje katalog všem stejně,
// takže nepotřebuje cookies a jeho výsledky jde cachovat napříč návštěvníky.
export function createPublicClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
