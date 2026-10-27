'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { siteOrigin } from '@/lib/auth-helpers';
import type { Candidate, ShippingTerms } from '@/lib/cart-optimize';
import { sendOrderEmail } from '@/lib/email';
import { CARRIERS, type Carrier, type PaymentMethod, type SellerOffer } from '@/lib/delivery';
import { createClient } from '@/lib/supabase/server';

export interface PlaceOrderResult {
  error?: string;
  orderIds?: string[];
}

/** Doprava a platba prodejců v košíku (profily a ceníky jsou veřejné, číslo účtu ne). */
export async function getSellerOffers(sellerIds: string[]): Promise<Record<string, SellerOffer>> {
  if (!sellerIds.length) return {};
  const ids = sellerIds.slice(0, 100);
  const supabase = await createClient();
  const [{ data: profiles }, { data: methods }, { data: rates }] = await Promise.all([
    supabase.from('profiles').select('id, free_shipping_from, pickup, pickup_place, pickup_radius_km, cash_on_pickup, pay_transfer').in('id', ids),
    supabase.from('seller_shipping_methods').select('seller_id, carrier, label, price_czk, cod, cod_fee_czk').in('seller_id', ids),
    supabase.from('carrier_rates').select('carrier, price_czk'),
  ]);
  const list = new Map((rates ?? []).map((r) => [r.carrier as string, r.price_czk as number]));
  const order = new Map(CARRIERS.map((c, i) => [c.key, i]));
  return Object.fromEntries((profiles ?? []).map((p) => [p.id, {
    pickup: p.pickup,
    pickupPlace: p.pickup ? p.pickup_place || 'po domluvě' : null,
    pickupRadius: p.pickup_radius_km,
    cashOnPickup: p.cash_on_pickup,
    transfer: p.pay_transfer,
    freeFrom: p.free_shipping_from,
    methods: (methods ?? [])
      .filter((m) => m.seller_id === p.id)
      .map((m) => ({ carrier: m.carrier as Carrier, label: m.label, price: m.price_czk, cod: m.cod, codFee: m.cod_fee_czk, listPrice: list.get(m.carrier) ?? null }))
      .sort((a, b) => (order.get(a.carrier) ?? 99) - (order.get(b.carrier) ?? 99)),
  } satisfies SellerOffer]));
}

const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL'];

export interface CartAlternatives {
  /** Pro každou nabídku z košíku: nabídky téže karty ve stejném nebo lepším stavu a jazyce (včetně jí samé) */
  candidates: Record<string, Candidate[]>;
  terms: Record<string, ShippingTerms>;
}

/** Stejné karty u jiných prodejců, pro varianty košíku (nejlevněji, nejméně prodejců). */
export async function getCartAlternatives(listingIds: string[]): Promise<CartAlternatives> {
  const ids = listingIds.slice(0, 60);
  if (!ids.length) return { candidates: {}, terms: {} };
  const supabase = await createClient();
  const [{ data: own }, user] = await Promise.all([
    supabase.from('listings').select('id, card_id, condition, language').in('id', ids),
    getCurrentUser(),
  ]);
  const originals = own ?? [];
  const cardIds = [...new Set(originals.map((l) => l.card_id))];
  if (!cardIds.length) return { candidates: {}, terms: {} };
  const { data: offers } = await supabase
    .from('listings')
    .select('id, card_id, seller_id, price_czk, condition, language, quantity, profiles(display_name, shipping_czk, free_shipping_from)')
    .in('card_id', cardIds)
    .gt('quantity', 0)
    // Cena dohodou do košíku nejde.
    .not('price_czk', 'is', null)
    .order('price_czk')
    .limit(2000);

  const terms: Record<string, ShippingTerms> = {};
  const candidates: Record<string, Candidate[]> = {};
  for (const o of originals) {
    const rank = CONDITIONS.indexOf(o.condition);
    candidates[o.id] = (offers ?? [])
      .filter((l) => l.card_id === o.card_id && l.language === o.language && CONDITIONS.indexOf(l.condition) <= rank && l.seller_id !== user?.id)
      .map((l) => {
        const p = (Array.isArray(l.profiles) ? l.profiles[0] : l.profiles) as { display_name: string; shipping_czk: number; free_shipping_from: number | null } | null;
        terms[l.seller_id] = { shipping: p?.shipping_czk ?? 89, freeFrom: p?.free_shipping_from ?? null };
        return {
          listingId: l.id,
          sellerId: l.seller_id,
          sellerName: p?.display_name ?? 'Prodejce',
          price: l.price_czk,
          condition: l.condition,
          language: l.language,
          maxQuantity: l.quantity,
        };
      });
  }
  return { candidates, terms };
}

/** Volba kupujícího u jednoho prodejce: doprava (dopravce nebo osobní předání), platba a výdejní místo. */
export interface SellerChoice { delivery: string; payment: PaymentMethod; point?: string }

export async function placeOrder(items: Array<{ listingId: string; quantity: number }>, choices: Record<string, SellerChoice>): Promise<PlaceOrderResult> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: 'Pro objednávku se nejdřív přihlaste.' };

  const { data, error } = await supabase.rpc('place_order', {
    items: items.map((i) => ({ listing_id: i.listingId, quantity: i.quantity })),
    choices,
  });
  // Chyby z databáze jsou psané česky pro zákazníka (viz place_order).
  if (error) return { error: error.message || 'Objednávku se nepodařilo vytvořit.' };

  const orderIds = (data ?? []) as string[];
  const origin = await siteOrigin();
  // Každý prodejce dostane e-mail o nové objednávce, odpověď kupujícímu kvůli tomu nezdržujeme.
  after(() => Promise.all(orderIds.map((id) => sendOrderEmail(supabase, id, 'requested', user.displayName, origin))));

  revalidatePath('/', 'layout');
  return { orderIds };
}
