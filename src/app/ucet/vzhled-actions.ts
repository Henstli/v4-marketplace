'use server';

import { revalidatePath } from 'next/cache';
import { toPlan } from '@/lib/plans';
import { COLLECTOR_STYLES, frameAllowed, matAllowed, sanitizeCrop, SHOP_STYLES } from '@/lib/profile-card';
import { createClient } from '@/lib/supabase/server';

export interface AppearanceState {
  error?: string;
  ok?: boolean;
}

/** Vzhled profilu (DS Trezor › ProfileCard, ProfileMat): fotka, typová řádka, rámeček, status, stav, podložka a odznak věrnosti. */
export async function updateAppearance(_prev: AppearanceState, form: FormData): Promise<AppearanceState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Nejste přihlášeni.' };

  const { data: prof } = await supabase.from('profiles').select('kind').eq('id', auth.user.id).single();
  const kind = prof?.kind === 'shop' ? 'shop' : 'private';
  const style = String(form.get('style') ?? '');
  const styles = kind === 'shop' ? SHOP_STYLES.map((s) => s.id) : COLLECTOR_STYLES.map((s) => s.id);
  if (style && !styles.includes(style)) return { error: 'Vyberte styl ze seznamu.' };
  const cardForm = form.get('form') === 'f' ? 'f' : 'm';
  const city = String(form.get('city') ?? '').trim().replace(/\s+/g, ' ');
  if (city.length > 40) return { error: 'Město může mít nejvýš 40 znaků.' };
  const status = String(form.get('status') ?? '').trim().replace(/\s+/g, ' ');
  if (status.length > 60) return { error: 'Status může mít nejvýš 60 znaků.' };
  const presence = String(form.get('presence') ?? 'auto');
  if (!['auto', 'dnd', 'hidden'].includes(presence)) return { error: 'Vyberte stav.' };
  const frame = String(form.get('frame') ?? 'sklo');
  const { data: plan } = await supabase.rpc('current_plan');
  if (!frameAllowed(frame, toPlan(plan))) return { error: 'Tento rámeček je pro Plus a Pro.' };
  const mat = String(form.get('mat') ?? 'lava');
  if (!matAllowed(mat, toPlan(plan))) return { error: 'Tahle podložka je pro vyšší tarif.' };
  const loyaltyHidden = form.get('loyalty') === 'hide';

  const photoPath = String(form.get('photoPath') ?? '');
  if (photoPath && !new RegExp(`^${auth.user.id}/avatar-[a-z0-9]+\\.(jpg|png|webp)$`).test(photoPath)) return { error: 'Fotku se nepodařilo uložit, nahrajte ji znovu.' };
  let crop = null;
  try { crop = photoPath ? sanitizeCrop(JSON.parse(String(form.get('photoCrop') ?? ''))) : null; } catch { crop = null; }
  if (photoPath && !crop) return { error: 'Výřez fotky se nepodařilo uložit, zkuste ho posunout znovu.' };

  const { error } = await supabase.from('profiles').update({
    avatar_path: photoPath || null,
    avatar_crop: crop,
    card_style: style || null,
    card_form: cardForm,
    card_city: city || null,
    status_text: status || null,
    presence_mode: presence,
    card_frame: frame,
    profile_mat: mat,
    loyalty_hidden: loyaltyHidden,
  }).eq('id', auth.user.id);
  if (error) return { error: 'Vzhled se nepodařilo uložit.' };
  revalidatePath('/ucet/vzhled');
  revalidatePath(`/prodejci/${auth.user.id}`);
  return { ok: true };
}
