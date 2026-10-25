'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Oprávnění hlídá databázová funkce admin_set_subscription (jen správce).
async function setSubscription(form: FormData, active: boolean) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_set_subscription', {
    p_email: String(form.get('email') ?? '').trim().slice(0, 200),
    p_active: active,
    p_note: String(form.get('note') ?? '').trim().slice(0, 200) || null,
  });
  revalidatePath('/sprava/predplatne');
  if (error) redirect(`/sprava/predplatne?chyba=${encodeURIComponent(error.message)}`);
  redirect(`/sprava/predplatne?ok=${encodeURIComponent(`${data ?? 'Prodejce'}: předplatné ${active ? 'přiděleno' : 'odebráno'}`)}`);
}

export async function grantSubscription(form: FormData) {
  await setSubscription(form, true);
}

export async function revokeSubscription(form: FormData) {
  await setSubscription(form, false);
}
