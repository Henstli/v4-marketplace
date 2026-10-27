import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './config';

/**
 * Klient se service_role klíčem obchází RLS. Jen pro práci na pozadí (e-maily čekajícím),
 * nikdy pro data, která jdou do prohlížeče. Bez proměnné SUPABASE_SERVICE_ROLE_KEY vrací null.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
