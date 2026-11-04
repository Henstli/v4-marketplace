import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Řádek skladu: nabídka (karta + stav + jazyk) s neveřejnými údaji skladu a tržní cenou. */
export interface StockRow {
  id: string;
  cardId: string;
  /** Cena za kus, null = dohodou (na prodej) nebo bez ceny (mimo prodej) */
  price: number | null;
  condition: string;
  language: string;
  /** Kusy na prodej (veřejné) */
  quantity: number;
  /** Kusy mimo prodej */
  keep: number;
  /** Kusy na výměnu (smí se překrývat s prodejem) */
  trade: number;
  location: string | null;
  buyPrice: number | null;
  listedAt: string | null;
  createdAt: string;
  /** Poslední změna řádku skladu */
  updatedAt: string;
  /** Odkud karta přišla: manual, import, photo, app */
  source: string;
  /** Skrytá podporou (kusy odložené) */
  hidden: number | null;
  /** Odstraněná podporou */
  removed: boolean;
  /** Tržní cena za kus: poslední průměr z historie cen, jinak nejnižší nabídka */
  market: number | null;
  card: { slug: string; name: string; setName: string; setCode: string; number: string; image: string | null; game: string | null } | null;
}

/** Řádek z funkce stock_load (krátké klíče kvůli velikosti odpovědi). */
type LoadRow = {
  id: string; cid: string; p: number | null; co: string; la: string; q: number; h: number | null; rm: boolean; ca: string;
  k: number | null; t: number | null; lo: string | null; b: number | null; li: string | null; so: string | null; u: string | null;
  c: { slug: string; name: string; number: string; image: string | null; game: string | null; code: string | null; set: string | null } | null;
  m: number | null;
};

/**
 * Celý sklad i s tržními cenami jedním dotazem (funkce stock_load: majitel nebo tým s právem 'view',
 * stejně jako RLS). Dřív to bylo až 10 stránek po 1000 řádcích za sebou a k tomu stock_market.
 */
export function loadStock(supabase: SupabaseClient, userId: string): Promise<StockRow[]> {
  // V rámci jednoho požadavku (stránka, záložka Trh, ceny) se sklad načte jen jednou.
  const memo = stockMemo(userId);
  memo.p ??= fetchStock(supabase, userId);
  return memo.p;
}

const stockMemo = cache((_owner: string): { p: Promise<StockRow[]> | null } => ({ p: null }));

async function fetchStock(supabase: SupabaseClient, userId: string): Promise<StockRow[]> {
  const { data, error } = await supabase.rpc('stock_load', { p_owner: userId });
  if (error) console.error('stock_load', error.message);
  return ((data ?? []) as LoadRow[]).map((l) => ({
    id: l.id,
    cardId: l.cid,
    price: l.p,
    condition: l.co,
    language: l.la,
    quantity: l.q,
    keep: l.k ?? 0,
    trade: l.t ?? 0,
    location: l.lo ?? null,
    buyPrice: l.b ?? null,
    listedAt: l.li ?? null,
    createdAt: l.ca,
    updatedAt: l.u ?? l.ca,
    source: l.so ?? 'manual',
    hidden: l.h,
    removed: l.rm,
    market: l.m ?? null,
    card: l.c
      ? { slug: l.c.slug, name: l.c.name, number: l.c.number, image: l.c.image, game: l.c.game, setCode: l.c.code ?? '', setName: l.c.set ?? '' }
      : null,
  }));
}

/** Mám = na prodej + mimo prodej (u skryté podporou i odložené kusy). */
export const owned = (r: Pick<StockRow, 'quantity' | 'keep' | 'hidden'>) => r.quantity + r.keep + (r.hidden ?? 0);
