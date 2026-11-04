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
  /** Skrytá podporou (kusy odložené) */
  hidden: number | null;
  /** Odstraněná podporou */
  removed: boolean;
  /** Tržní cena za kus: poslední průměr z historie cen, jinak nejnižší nabídka */
  market: number | null;
  card: { slug: string; name: string; setName: string; setCode: string; number: string; image: string | null; game: string | null } | null;
}

type CardRow = {
  slug: string; name: string; number: string; image_url: string | null; game_id: string | null;
  card_sets: { code: string; name: string } | { code: string; name: string }[] | null;
};
type StockExtra = { keep_qty: number; trade_qty: number; location: string | null; buy_price_czk: number | null; listed_at: string | null };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Celý sklad přihlášeného (Supabase vrací nejvýš 1000 řádků na dotaz, čteme po stránkách, nejvýš 10 000). */
export async function loadStock(supabase: SupabaseClient, userId: string): Promise<StockRow[]> {
  const raw = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data } = await supabase
      .from('listings')
      .select('id, card_id, price_czk, condition, language, quantity, hidden_qty, removed_at, created_at, listing_stock(keep_qty, trade_qty, location, buy_price_czk, listed_at), cards(slug, name, number, image_url, game_id, card_sets(code, name))')
      .eq('seller_id', userId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + 999);
    raw.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const cardIds = [...new Set(raw.map((l) => l.card_id as string))];
  const market = new Map<string, number | null>();
  for (let i = 0; i < cardIds.length; i += 2000) {
    const { data } = await supabase.rpc('stock_market', { p_cards: cardIds.slice(i, i + 2000) });
    for (const m of (data ?? []) as { card_id: string; market_czk: number | null; low_czk: number | null }[]) {
      market.set(m.card_id, m.market_czk ?? m.low_czk ?? null);
    }
  }

  return raw.map((l) => {
    const card = one(l.cards as unknown as CardRow | CardRow[] | null);
    const set = one(card?.card_sets);
    const st = one(l.listing_stock as unknown as StockExtra | StockExtra[] | null);
    return {
      id: l.id,
      cardId: l.card_id,
      price: l.price_czk,
      condition: l.condition,
      language: l.language,
      quantity: l.quantity,
      keep: st?.keep_qty ?? 0,
      trade: st?.trade_qty ?? 0,
      location: st?.location ?? null,
      buyPrice: st?.buy_price_czk ?? null,
      listedAt: st?.listed_at ?? null,
      createdAt: l.created_at,
      hidden: l.hidden_qty,
      removed: !!l.removed_at,
      market: market.get(l.card_id) ?? null,
      card: card
        ? { slug: card.slug, name: card.name, number: card.number, image: card.image_url, game: card.game_id, setCode: set?.code ?? '', setName: set?.name ?? '' }
        : null,
    };
  });
}

/** Mám = na prodej + mimo prodej (u skryté podporou i odložené kusy). */
export const owned = (r: Pick<StockRow, 'quantity' | 'keep' | 'hidden'>) => r.quantity + r.keep + (r.hidden ?? 0);
