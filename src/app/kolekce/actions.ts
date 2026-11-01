'use server';

import { revalidatePath } from 'next/cache';
import { compareCardNumbers } from '@/lib/album/designs';
import { findSetsAndSellers, getOffers, searchCards } from '@/lib/catalog';
import type { GameId } from '@/lib/games';
import { createClient } from '@/lib/supabase/server';
import { CONDITION_NAMES } from '@/lib/types';
import { albumsForCard } from '@/lib/collection';

export type Result<T = object> = ({ ok: true } & T) | { error: string };

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 60);
const isId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

async function user() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, uid: (data?.claims?.sub as string | undefined) ?? null };
}

function refresh(albumId?: string) {
  revalidatePath('/kolekce');
  if (albumId) revalidatePath(`/kolekce/${albumId}`);
}

export interface NewAlbum {
  name: string;
  design: number;
  sleeve: number;
  kind: 'set' | 'custom';
  setId?: string | null;
  /** Karty, které už uživatel má (u vlastního alba všechny karty alba v pořadí) */
  cardIds: string[];
}

/** Založí album a rovnou do sbírky vloží karty, které uživatel označil. */
export async function createAlbum(a: NewAlbum): Promise<Result<{ id: string }>> {
  const { supabase, uid } = await user();
  if (!uid) return { error: 'Přihlaste se' };
  const name = clean(a.name);
  if (!name) return { error: 'Zadejte název alba' };
  if (a.kind === 'set' && !isId(a.setId)) return { error: 'Vyberte sadu' };
  const ids = a.cardIds.filter(isId).slice(0, 2000);
  const { data, error } = await supabase.from('collection_albums').insert({
    user_id: uid, name, kind: a.kind, set_id: a.kind === 'set' ? a.setId : null,
    design: Math.min(20, Math.max(1, Math.round(a.design))), sleeve: Math.min(20, Math.max(1, Math.round(a.sleeve))),
  }).select('id').single();
  if (error || !data) return { error: 'Album se nepodařilo založit' };
  if (ids.length) {
    const { error: e2 } = await supabase.rpc('collection_add', { p_cards: ids, p_album: data.id });
    if (e2) return { error: 'Album je založené, ale karty se nepodařilo vložit' };
  }
  refresh(data.id);
  return { ok: true, id: data.id };
}

/** Vloží karty do sbírky (a na konec vlastního alba). Opakované id = další kus. */
export async function addCards(cardIds: string[], albumId?: string | null): Promise<Result<{ added: number }>> {
  const { supabase, uid } = await user();
  if (!uid) return { error: 'login' };
  const ids = cardIds.filter(isId).slice(0, 2000);
  if (!ids.length) return { error: 'Nic k přidání' };
  const { data, error } = await supabase.rpc('collection_add', { p_cards: ids, p_album: isId(albumId) ? albumId : null });
  if (error) return { error: 'Karty se nepodařilo přidat' };
  refresh(isId(albumId) ? albumId : undefined);
  return { ok: true, added: Number(data) || ids.length };
}

/** Odebere jeden kus karty ze sbírky (poslední kus kartu odebere úplně, i z vlastních alb). */
export async function removeCard(cardId: string, albumId?: string): Promise<Result> {
  const { supabase, uid } = await user();
  if (!uid || !isId(cardId)) return { error: 'login' };
  const { data } = await supabase.from('collection_cards').select('quantity').eq('card_id', cardId).maybeSingle<{ quantity: number }>();
  if (data && data.quantity > 1) await supabase.from('collection_cards').update({ quantity: data.quantity - 1 }).eq('card_id', cardId);
  else {
    await supabase.from('collection_cards').delete().eq('card_id', cardId);
    if (isId(albumId)) await supabase.from('collection_album_cards').delete().eq('album_id', albumId).eq('card_id', cardId);
  }
  refresh(albumId);
  return { ok: true };
}

/** Ukázat album na profilu, nebo ho z profilu skrýt (hrací podložka P5). */
export async function setAlbumOnProfile(id: string, on: boolean): Promise<Result> {
  const { supabase, uid } = await user();
  if (!uid || !isId(id)) return { error: 'login' };
  const { error } = await supabase.from('collection_albums').update({ on_profile: on }).eq('id', id);
  if (error) return { error: 'Změnu se nepodařilo uložit' };
  refresh(id);
  revalidatePath(`/prodejci/${uid}`);
  return { ok: true };
}

export async function updateAlbum(id: string, p: { name?: string; design?: number; sleeve?: number }): Promise<Result> {
  const { supabase, uid } = await user();
  if (!uid || !isId(id)) return { error: 'login' };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.name !== undefined) {
    const n = clean(p.name);
    if (!n) return { error: 'Zadejte název alba' };
    patch.name = n;
  }
  if (p.design) patch.design = Math.min(20, Math.max(1, Math.round(p.design)));
  if (p.sleeve) patch.sleeve = Math.min(20, Math.max(1, Math.round(p.sleeve)));
  const { error } = await supabase.from('collection_albums').update(patch).eq('id', id);
  if (error) return { error: 'Změnu se nepodařilo uložit' };
  refresh(id);
  return { ok: true };
}

/** Smaže album. Karty zůstanou ve sbírce. */
export async function deleteAlbum(id: string): Promise<Result> {
  const { supabase, uid } = await user();
  if (!uid || !isId(id)) return { error: 'login' };
  const { error } = await supabase.from('collection_albums').delete().eq('id', id);
  if (error) return { error: 'Album se nepodařilo smazat' };
  refresh();
  return { ok: true };
}

export interface SetOption {
  id: string;
  name: string;
  code: string;
  year: number | null;
  game: GameId;
  cards: number;
  owned: number;
}

/** Sady pro průvodce založením: bez hledání nejnovější sady hry, s hledáním podle názvu, kódu nebo roku. */
export async function findSets(game: GameId, q: string): Promise<SetOption[]> {
  const { supabase, uid } = await user();
  let sets: Array<Omit<SetOption, 'owned'>> = [];
  if (q.trim().length >= 2) {
    const r = await findSetsAndSellers(q, game);
    sets = r.sets.slice(0, 16).map((s) => ({ id: s.id, name: s.name, code: s.code, year: s.year, game: s.game, cards: s.cards }));
  } else {
    const { data } = await supabase.from('card_sets').select('id, name, code, released_on, game_id').eq('game_id', game)
      .order('released_on', { ascending: false, nullsFirst: false }).limit(12)
      .returns<Array<{ id: string; name: string; code: string; released_on: string | null; game_id: GameId }>>();
    const counts = await Promise.all((data ?? []).map((s) =>
      supabase.from('cards').select('id', { count: 'exact', head: true }).eq('set_id', s.id).eq('hidden', false)));
    sets = (data ?? []).map((s, i) => ({
      id: s.id, name: s.name, code: s.code, year: s.released_on ? Number(s.released_on.slice(0, 4)) : null, game: s.game_id,
      cards: counts[i].count ?? 0,
    })).filter((s) => s.cards > 0);
  }
  const owned = new Map<string, number>();
  if (uid && sets.length) {
    const { data } = await supabase.from('collection_cards').select('card_id, cards!inner(set_id)')
      .in('cards.set_id', sets.map((s) => s.id)).returns<Array<{ card_id: string; cards: { set_id: string } }>>();
    for (const r of data ?? []) owned.set(r.cards.set_id, (owned.get(r.cards.set_id) ?? 0) + 1);
  }
  return sets.map((s) => ({ ...s, owned: owned.get(s.id) ?? 0 }));
}

export interface PickCard {
  id: string;
  slug: string;
  name: string;
  number: string;
  rarity: string | null;
  image: string | null;
  setName: string;
  owned: number;
  minPrice?: number | null;
}

/** Karty sady v pořadí podle čísla (krok „Karty, které už máš“). */
export async function setCards(setId: string): Promise<PickCard[]> {
  const { supabase, uid } = await user();
  if (!isId(setId)) return [];
  const { data } = await supabase.from('cards').select('id, slug, name, number, rarity, image_url, card_sets(name)').eq('set_id', setId)
    .eq('hidden', false).limit(1000)
    .returns<Array<{ id: string; slug: string; name: string; number: string; rarity: string | null; image_url: string | null; card_sets: { name: string } | null }>>();
  const rows = (data ?? []).sort((a, b) => compareCardNumbers(a.number, b.number));
  const owned = new Map<string, number>();
  if (uid && rows.length) {
    const { data: o } = await supabase.from('collection_cards').select('card_id, quantity, cards!inner(set_id)').eq('cards.set_id', setId)
      .returns<Array<{ card_id: string; quantity: number }>>();
    for (const r of o ?? []) owned.set(r.card_id, r.quantity);
  }
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, number: r.number, rarity: r.rarity, image: r.image_url,
    setName: r.card_sets?.name ?? '', owned: owned.get(r.id) ?? 0,
  }));
}

/** Hledání v celém katalogu pro vlastní album. */
export async function searchForAlbum(q: string, game?: GameId | null): Promise<PickCard[]> {
  if (q.trim().length < 2) return [];
  const { supabase, uid } = await user();
  const page = await searchCards({ q, game: game ?? undefined, pageSize: 30 });
  const owned = new Map<string, number>();
  if (uid && page.cards.length) {
    const { data } = await supabase.from('collection_cards').select('card_id, quantity').in('card_id', page.cards.map((c) => c.id));
    for (const r of (data ?? []) as Array<{ card_id: string; quantity: number }>) owned.set(r.card_id, r.quantity);
  }
  return page.cards.map((c) => ({
    id: c.id, slug: c.slug, name: c.name, number: c.number, rarity: c.rarity || null, image: c.image ?? null,
    setName: c.setName, owned: owned.get(c.id) ?? 0, minPrice: c.minPrice,
  })).sort((a, b) => Number(b.owned > 0) - Number(a.owned > 0));
}

export interface CheapOffer {
  seller: string;
  condition: string;
  price: number | null;
}

/** Nejlevnější nabídky chybějící karty (panel u prázdné kapsy). */
export async function cardOffers(cardId: string): Promise<{ offers: CheapOffer[]; count: number }> {
  if (!isId(cardId)) return { offers: [], count: 0 };
  const all = await getOffers(cardId).catch(() => []);
  return {
    count: all.length,
    offers: all.slice(0, 3).map((o) => ({ seller: o.seller?.name ?? 'Prodejce', condition: CONDITION_NAMES[o.condition] ?? o.condition, price: o.price })),
  };
}

/** Alba pro tlačítko „Mám ji“ na stránce karty. null = nepřihlášený. */
export async function cardAlbums(cardId: string) {
  const { uid } = await user();
  if (!uid || !isId(cardId)) return null;
  return albumsForCard(cardId);
}
