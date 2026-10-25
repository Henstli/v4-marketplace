'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PLANS, toPlan } from '@/lib/plans';
import { createClient } from '@/lib/supabase/server';

// Oprávnění hlídá databázová funkce admin_set_plan (jen správce). Tarif „free“ předplatné odebere.
export async function setPlan(form: FormData) {
  const plan = toPlan(form.get('plan'));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_set_plan', {
    p_email: String(form.get('email') ?? '').trim().slice(0, 200),
    p_plan: plan,
    p_note: String(form.get('note') ?? '').trim().slice(0, 200) || null,
  });
  revalidatePath('/sprava/predplatne');
  if (error) redirect(`/sprava/predplatne?chyba=${encodeURIComponent(error.message)}`);
  redirect(`/sprava/predplatne?ok=${encodeURIComponent(`${data ?? 'Prodejce'}: tarif ${PLANS[plan].name}`)}`);
}
