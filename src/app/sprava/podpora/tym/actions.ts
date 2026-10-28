'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const ROLES = ['admin', 'support', 'none'];

// Oprávnění hlídá databáze (team_set_role: jen správce s dvoufázovým ověřením, ne sám sobě).
export async function setTeamRole(form: FormData) {
  const email = String(form.get('email') ?? '').trim().slice(0, 200);
  const role = String(form.get('role') ?? '');
  const go = (q: Record<string, string>) => redirect(`/sprava/podpora/tym?${new URLSearchParams(q)}`);
  if (!email || !ROLES.includes(role)) go({ chyba: 'Vyplňte e-mail a roli' });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('team_set_role', { p_email: email, p_role: role });
  if (error) go({ chyba: error.message });
  revalidatePath('/sprava/podpora/tym');
  go({ ok: role === 'none' ? `${data} už není v týmu` : `${data} má roli ${role === 'admin' ? 'Správce' : 'Podpora'}` });
}
