'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Oprávnění hlídá databázová funkce review_card_submission (jen správce).
async function review(form: FormData, approve: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('review_card_submission', {
    target: String(form.get('id') ?? ''),
    approve,
    reason: String(form.get('reason') ?? '').trim().slice(0, 300) || null,
  });
  revalidatePath('/sprava/karty');
  if (error) redirect(`/sprava/karty?chyba=${encodeURIComponent(error.message)}`);
  revalidatePath('/karty', 'layout');
}

export async function approveSubmission(form: FormData) {
  await review(form, true);
}

export async function rejectSubmission(form: FormData) {
  await review(form, false);
}
