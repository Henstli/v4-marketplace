'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/** Znovu stáhne sady hry, které skončily chybou (DB funkce admin_catalog_retry, jen správce). */
export async function retryCatalog(form: FormData) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) redirect('/');
  const game = String(form.get('game') ?? '');
  const back = String(form.get('back') ?? '/sprava/prehled');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_catalog_retry', { p_game: game });
  revalidatePath('/sprava/prehled');
  const msg = error ? `chyba=${encodeURIComponent(error.message)}` : `ok=${encodeURIComponent(`Znovu se stahuje ${data ?? 0} sad, výsledek uvidíte za pár minut.`)}`;
  redirect(`${back}${back.includes('?') ? '&' : '?'}${msg}`);
}
