'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface SubmissionState {
  error?: string;
  ok?: boolean;
}

const LIMITS: Record<string, [number, number]> = {
  player: [2, 80],
  season: [4, 20],
  manufacturer: [2, 40],
  set_name: [2, 80],
  number: [1, 20],
};

export async function submitCard(form: FormData): Promise<SubmissionState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Pro návrh karty se nejdřív přihlaste.' };

  const field = (name: string) => String(form.get(name) ?? '').trim();
  for (const [name, [min, max]] of Object.entries(LIMITS)) {
    const value = field(name);
    if (value.length < min || value.length > max) return { error: 'Vyplňte prosím všechna povinná pole.' };
  }
  const imagePath = field('image_path');
  // Fotka už je nahraná z prohlížeče, a to jen do složky přihlášeného uživatele.
  if (!imagePath.startsWith(`${auth.user.id}/`)) return { error: 'Přiložte prosím fotku karty.' };

  const { error } = await supabase.from('card_submissions').insert({
    submitted_by: auth.user.id,
    player: field('player'),
    season: field('season'),
    manufacturer: field('manufacturer'),
    set_name: field('set_name'),
    number: field('number'),
    variant: field('variant').slice(0, 60) || null,
    note: field('note').slice(0, 300) || null,
    image_path: imagePath,
  });
  if (error) return { error: 'Návrh se nepodařilo uložit. Zkuste to prosím znovu.' };

  revalidatePath('/prodat/nova-karta');
  revalidatePath('/sprava/karty');
  return { ok: true };
}
