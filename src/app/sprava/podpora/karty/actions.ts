'use server';

import { revalidatePath } from 'next/cache';
import { refreshCatalog } from '@/lib/catalog-refresh';
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
  revalidatePath('/sprava/podpora/karty');
  if (error) redirect(`/sprava/podpora/karty?chyba=${encodeURIComponent(error.message)}`);
  refreshCatalog();
}

export async function approveSubmission(form: FormData) {
  await review(form, true);
}

export async function rejectSubmission(form: FormData) {
  await review(form, false);
}
