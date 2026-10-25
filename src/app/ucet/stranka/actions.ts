'use server';

import { revalidatePath } from 'next/cache';
import { PLANS, toPlan } from '@/lib/plans';
import { sanitizeConfig, shopHref } from '@/lib/shop-config';
import { configToRow } from '@/lib/shop';
import { createClient } from '@/lib/supabase/server';
import type { GameId } from '@/lib/games';

export interface SaveState {
  error?: string;
  ok?: boolean;
  /** Adresa stránky po uložení */
  href?: string;
}

/** Uloží nastavení stránky. Zdarma jen profil (O mně a obrázek), Plus a Pro celé nastavení. */
export async function saveShopPage(json: string): Promise<SaveState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Nejste přihlášeni.' };
  if (json.length > 200_000) return { error: 'Nastavení je příliš velké.' };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: 'Nastavení se nepodařilo přečíst.' };
  }
  const [{ data: profile }, { data: planCode }] = await Promise.all([
    supabase.from('profiles').select('kind').eq('id', auth.user.id).single(),
    supabase.rpc('current_plan'),
  ]);
  const kind = profile?.kind === 'shop' ? 'shop' : 'private';
  const plan = PLANS[toPlan(planCode)];
  const config = sanitizeConfig(raw, auth.user.id, kind);

  const row = plan.shopPage
    ? configToRow(config)
    : { about: config.about || null, logo_path: config.logoPath || null, updated_at: new Date().toISOString() };
  if (plan.shopPage && config.published && !config.slug) return { error: 'Před zveřejněním vyberte adresu stránky.' };

  const { error } = await supabase.from('shop_pages').upsert({ user_id: auth.user.id, ...row }, { onConflict: 'user_id' });
  if (error) {
    if (error.code === '23505') return { error: 'Tuhle adresu už má jiný prodejce, zkuste jinou.' };
    if (error.code === '42501') return { error: 'Uložení vyžaduje dvoufázové ověření, pokud ho máte zapnuté. Přihlaste se znovu s kódem.' };
    return { error: 'Stránku se nepodařilo uložit.' };
  }
  revalidatePath(`/prodejci/${auth.user.id}`);
  const href = plan.shopPage && config.slug ? shopHref(kind, config.slug) : `/prodejci/${auth.user.id}`;
  revalidatePath(href);
  return { ok: true, href };
}

export interface PickerCard {
  id: string;
  name: string;
  number: string;
  setCode: string;
  image?: string;
  game: GameId;
}

/** Karty z katalogu pro Vitrínu a Hledám */
export async function findCatalogCards(q: string): Promise<PickerCard[]> {
  // Stejné hledání jako katalog: slova bez diakritiky jako předpony nad sloupcem search.
  const words = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g)?.slice(0, 6) ?? [];
  if (!words.length || words.join('').length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('cards')
    .select('id, name, number, image_url, card_sets(game_id, code)')
    .textSearch('search', words.map((w) => `${w}:*`).join(' & '), { config: 'simple' })
    .limit(10);
  return (data ?? []).map((c) => {
    const s = (Array.isArray(c.card_sets) ? c.card_sets[0] : c.card_sets) as { game_id: GameId; code: string } | null;
    return { id: c.id, name: c.name, number: c.number, setCode: s?.code ?? '', image: c.image_url ?? undefined, game: s?.game_id ?? 'pokemon' };
  });
}
