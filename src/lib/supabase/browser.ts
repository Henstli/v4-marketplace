import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_KEY, SUPABASE_URL } from './config';

/** Klient v prohlížeči, jen na nahrávání souborů přímo do úložiště (obejde limit velikosti server actions). */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
}
