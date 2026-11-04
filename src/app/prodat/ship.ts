import type { SupabaseClient } from '@supabase/supabase-js';
import { methodName, type PaymentMethod } from '@/lib/delivery';
import { loadDeliveries, type DeliveryRow } from '../objednavky/parts';

/** Položka objednávky k vychystání: karta, stav, jazyk, kusy a místo ve skladu. */
export interface ShipItem {
  key: string;
  name: string;
  slug: string;
  image: string | null;
  game: string | null;
  set: string;
  condition: string;
  language: string | null;
  qty: number;
  price: number;
  location: string | null;
}

export interface ShipOrder {
  id: string;
  number: number;
  status: string;
  /** ready = jde vychystat a odeslat, wait = čeká na zaplacení */
  ready: boolean;
  payment: PaymentMethod | null;
  delivery: 'ship' | 'pickup';
  carrier: string | null;
  carrierName: string;
  total: number;
  shipping: number;
  codFee: number;
  createdAt: string;
  buyerPaidAt: string | null;
  buyer: string;
  address: DeliveryRow | null;
  items: ShipItem[];
}

type Raw = {
  id: string; number: number; status: string; payment: PaymentMethod | null; delivery: 'ship' | 'pickup'; carrier: string | null; carrier_label: string | null;
  total_czk: number; shipping_czk: number; cod_fee_czk: number | null; created_at: string; buyer_paid_at: string | null; buyer_id: string | null;
  order_items: { id: string; listing_id: string | null; quantity: number; price_czk: number; condition: string;
    cards: { name: string; slug: string; image_url: string | null; game_id: string | null; number: string; card_sets: { code: string } | { code: string }[] | null } | null }[];
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * K odeslání: objednávky prodejce, které má zabalit a odeslat (zaplacené, dobírka, hotově při předání),
 * a potvrzené převodem, které čekají na zaplacení.
 */
export async function loadShipping(supabase: SupabaseClient, userId: string): Promise<{ orders: ShipOrder[]; toConfirm: number }> {
  const [{ data }, { count }] = await Promise.all([
    supabase.from('orders')
      .select('id, number, status, payment, delivery, carrier, carrier_label, total_czk, shipping_czk, cod_fee_czk, created_at, buyer_paid_at, buyer_id, order_items(id, listing_id, quantity, price_czk, condition, cards(name, slug, image_url, game_id, number, card_sets(code)))')
      .eq('seller_id', userId)
      .in('status', ['confirmed', 'pending_payment', 'paid'])
      .order('created_at')
      .limit(300),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('seller_id', userId).eq('status', 'requested'),
  ]);
  const raw = (data ?? []) as unknown as Raw[];

  const listingIds = [...new Set(raw.flatMap((o) => o.order_items.map((i) => i.listing_id).filter(Boolean) as string[]))];
  const buyerIds = [...new Set(raw.map((o) => o.buyer_id).filter(Boolean) as string[])];
  const [stock, langs, buyers, addresses] = await Promise.all([
    listingIds.length ? supabase.from('listing_stock').select('listing_id, location').in('listing_id', listingIds) : Promise.resolve({ data: [] }),
    listingIds.length ? supabase.from('listings').select('id, language').in('id', listingIds) : Promise.resolve({ data: [] }),
    buyerIds.length ? supabase.from('profiles').select('id, display_name').in('id', buyerIds) : Promise.resolve({ data: [] }),
    loadDeliveries(supabase, raw.map((o) => o.id)),
  ]);
  const loc = new Map(((stock.data ?? []) as { listing_id: string; location: string | null }[]).map((s) => [s.listing_id, s.location]));
  const lang = new Map(((langs.data ?? []) as { id: string; language: string }[]).map((l) => [l.id, l.language]));
  const name = new Map(((buyers.data ?? []) as { id: string; display_name: string | null }[]).map((b) => [b.id, b.display_name]));

  const orders = raw.map((o): ShipOrder => {
    const pay = o.payment;
    const ready = o.status === 'paid' || (o.status === 'confirmed' && (pay === 'cod' || pay === 'cash'));
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      ready,
      payment: pay,
      delivery: o.delivery,
      carrier: o.carrier,
      carrierName: o.delivery === 'pickup' ? 'Osobní předání' : o.carrier ? methodName({ carrier: o.carrier, label: o.carrier_label }) : 'Doprava',
      total: o.total_czk,
      shipping: o.shipping_czk,
      codFee: o.cod_fee_czk ?? 0,
      createdAt: o.created_at,
      buyerPaidAt: o.buyer_paid_at,
      buyer: addresses.get(o.id)?.recipient ?? (o.buyer_id ? name.get(o.buyer_id) : null) ?? 'Kupující',
      address: addresses.get(o.id) ?? null,
      items: o.order_items.map((i) => {
        const c = i.cards;
        return {
          key: i.id,
          name: c?.name ?? 'Karta',
          slug: c?.slug ?? '',
          image: c?.image_url ?? null,
          game: c?.game_id ?? null,
          set: [one(c?.card_sets)?.code?.toUpperCase(), c?.number].filter(Boolean).join(' '),
          condition: i.condition,
          language: i.listing_id ? lang.get(i.listing_id) ?? null : null,
          qty: i.quantity,
          price: i.price_czk,
          location: i.listing_id ? loc.get(i.listing_id) ?? null : null,
        };
      }),
    };
  });
  // Nejdřív, co jde odeslat, pak čekající na platbu; v každé skupině od nejstarší.
  orders.sort((a, b) => Number(b.ready) - Number(a.ready) || a.createdAt.localeCompare(b.createdAt));
  return { orders, toConfirm: count ?? 0 };
}
