import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_KEY, SUPABASE_URL } from './config';

/** Klient v prohlížeči: nahrávání souborů přímo do úložiště a časté dotazy na zprávy, které nemají jít přes Vercel. */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
}
