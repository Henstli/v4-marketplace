'use server';

import { revalidatePath } from 'next/cache';
import { searchCards } from '@/lib/catalog';
import { getGame, type GameId } from '@/lib/games';
import { QUANTITY_MAX } from '@/lib/import/columns';
import { PLANS, toPlan } from '@/lib/plans';
import type { CardLite } from '@/lib/import/rows';
import { createClient } from '@/lib/supabase/server';
import { CONDITIONS, LANGUAGE_NAMES } from '@/lib/types';

export interface MatchInput {
  idx: number;
  game: string | null;
  set_code: string;
  set_name: string;
  number: string;
  name: string;
}

export interface MatchResult {
  idx: number;
  status: 'ok' | 'multi' | 'none';
  candidates: CardLite[];
}

/** Najednou se páruje nejvýš tolik řádků (prohlížeč posílá soubor po částech). */
const MATCH_CHUNK = 200;

export async function matchImportRows(rows: MatchInput[]): Promise<{ results?: MatchResult[]; error?: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Přihlášení vypršelo. Přihlaste se prosím znovu.' };
  if (!Array.isArray(rows) || rows.length > MATCH_CHUNK) return { error: 'Příliš mnoho řádků najednou.' };
  const clean = rows.map((r) => ({
    idx: Number(r.idx),
    game: r.game && getGame(r.game) ? r.game : null,
    set_code: String(r.set_code ?? '').slice(0, 40),
    set_name: String(r.set_name ?? '').slice(0, 120),
    number: String(r.number ?? '').slice(0, 30),
    name: String(r.name ?? '').slice(0, 160),
  }));
  const { data, error } = await supabase.rpc('match_import_rows', { p_rows: clean });
  if (error) return { error: 'Párování s katalogem se nepovedlo. Zkuste to prosím znovu.' };
  return { results: (data ?? []) as MatchResult[] };
}

/** Ruční dohledání karty u řádku, který se nespároval. */
export async function searchImportCards(q: string, game?: string): Promise<CardLite[]> {
  const query = String(q ?? '').trim().slice(0, 80);
  if (query.length < 2) return [];
  const { cards } = await searchCards({ q: query, game: game && getGame(game) ? (game as GameId) : undefined, pageSize: 8 });
  return cards.map((c) => ({
    id: c.id, slug: c.slug, name: c.name, number: c.number, game: c.game,
    setCode: c.setCode, setName: c.setName, image: c.image ?? null,
  }));
}

export interface ImportItem {
  cardId: string;
  condition: string;
  language: string;
  price: number;
  quantity: number;
  graded?: string;
  note?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createImportedListings(items: ImportItem[]): Promise<{ created?: number; error?: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Přihlášení vypršelo. Přihlaste se prosím znovu.' };
  if (!Array.isArray(items) || !items.length) return { error: 'Není co vystavit.' };

  // Limit tarifu hlídá server; bez funkce v databázi (neaplikovaná migrace) platí limit zdarma.
  const free = PLANS.free.importRows ?? Infinity;
  if (items.length > free) {
    const { data: plan } = await supabase.rpc('current_plan');
    const limit = PLANS[toPlan(plan)].importRows;
    if (limit != null && items.length > limit) {
      return { error: `S vaším tarifem jde najednou vystavit nejvýš ${limit} řádků.` };
    }
  }

  const rows = [];
  for (const it of items) {
    const price = Number(it.price);
    const quantity = Number(it.quantity);
    if (!UUID.test(String(it.cardId))) return { error: 'U některého řádku chybí karta.' };
    if (!CONDITIONS.includes(it.condition as never)) return { error: 'U některého řádku chybí stav.' };
    if (!(it.language in LANGUAGE_NAMES)) return { error: 'U některého řádku chybí jazyk.' };
    if (!Number.isInteger(price) || price <= 0) return { error: 'Cena musí být celé číslo v korunách.' };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > QUANTITY_MAX) return { error: `Počet kusů musí být 1 až ${QUANTITY_MAX}.` };
    rows.push({
      card_id: it.cardId,
      seller_id: auth.user.id,
      price_czk: price,
      condition: it.condition,
      language: it.language,
      quantity,
      graded: String(it.graded ?? '').trim().slice(0, 20) || null,
      note: String(it.note ?? '').trim().slice(0, 200) || null,
    });
  }

  let created = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from('listings').insert(chunk);
    if (error) {
      if (created) revalidate();
      return {
        created,
        error: created
          ? `Vystavili jsme ${created} nabídek, zbytek se nepodařilo uložit. Zkuste ho nahrát znovu.`
          : 'Nabídky se nepodařilo uložit. Zkuste to prosím znovu.',
      };
    }
    created += chunk.length;
  }
  revalidate();
  return { created };
}

function revalidate() {
  revalidatePath('/prodat');
  revalidatePath('/karty', 'layout');
  revalidatePath('/prodejci', 'layout');
}
