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

// Hotové odpovědi: přidává, upravuje a maže jen správce (RLS support_templates).
export async function saveTemplate(form: FormData) {
  const go = (q: Record<string, string>) => redirect(`/sprava/podpora/tym?karta=odpovedi&${new URLSearchParams(q)}`);
  const id = String(form.get('id') ?? '').trim();
  const label = String(form.get('label') ?? '').trim().slice(0, 80);
  const body = String(form.get('body') ?? '').trim().slice(0, 4000);
  const sort = Math.round(Number(form.get('sort') ?? 100)) || 100;
  if (label.length < 2 || body.length < 10) go({ chyba: 'Vyplňte název a text (aspoň 10 znaků)' });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const row = { label, body, sort, updated_by: auth.user?.id ?? null, updated_at: new Date().toISOString() };
  const { error } = id
    ? await supabase.from('support_templates').update(row).eq('id', id)
    : await supabase.from('support_templates').insert(row);
  if (error) go({ chyba: error.message });
  revalidatePath('/sprava/podpora', 'layout');
  go({ ok: id ? 'Hotová odpověď upravena' : 'Hotová odpověď přidána' });
}

export async function deleteTemplate(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from('support_templates').delete().eq('id', String(form.get('id') ?? ''));
  revalidatePath('/sprava/podpora', 'layout');
  redirect(`/sprava/podpora/tym?karta=odpovedi&${new URLSearchParams(error ? { chyba: error.message } : { ok: 'Hotová odpověď smazána' })}`);
}
