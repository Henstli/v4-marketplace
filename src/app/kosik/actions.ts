'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { siteOrigin } from '@/lib/auth-helpers';
import type { Candidate, ShippingTerms } from '@/lib/cart-optimize';
import { sendOrderEmail } from '@/lib/email';
import { CARRIERS, type Carrier, type DeliveryAddress, type DeliveryPoint, type PaymentMethod, type SellerOffer } from '@/lib/delivery';
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
  const [{ data: profiles }, { data: methods }, { data: rates }, { data: prepay }] = await Promise.all([
    supabase.from('profiles').select('id, kind, free_shipping_from, pickup, pickup_place, pickup_radius_km, pickup_exact, cash_on_pickup, pay_transfer').in('id', ids),
    supabase.from('seller_shipping_methods').select('seller_id, carrier, label, price_czk, cod, cod_fee_czk').in('seller_id', ids),
    supabase.from('carrier_rates').select('carrier, price_czk'),
    // Jen ano/ne, které způsoby předem prodejce má; účet, PayPal a Revtag košík nevidí.
    supabase.rpc('seller_prepay_kinds', { ids }),
  ]);
  const kinds = new Map(((prepay ?? []) as Array<{ seller_id: string; bank: boolean; paypal: boolean; revolut: boolean }>)
    .map((k) => [k.seller_id, { bank: k.bank, paypal: k.paypal, revolut: k.revolut }]));
  const list = new Map((rates ?? []).map((r) => [r.carrier as string, r.price_czk as number]));
  const order = new Map(CARRIERS.map((c, i) => [c.key, i]));
  return Object.fromEntries((profiles ?? []).map((p) => {
    const kind = kinds.get(p.id) ?? { bank: p.pay_transfer, paypal: false, revolut: false };
    return [p.id, {
    private: p.kind !== 'shop',
    pickup: p.pickup,
    pickupPlace: p.pickup ? p.pickup_place || 'po domluvě' : null,
    pickupRadius: p.pickup_radius_km,
    pickupExact: p.pickup_exact,
    cashOnPickup: p.cash_on_pickup,
    transfer: kind.bank || kind.paypal || kind.revolut,
    prepay: kind,
    freeFrom: p.free_shipping_from,
    methods: (methods ?? [])
      .filter((m) => m.seller_id === p.id)
      .map((m) => ({ carrier: m.carrier as Carrier, label: m.label, price: m.price_czk, cod: m.cod, codFee: m.cod_fee_czk, listPrice: list.get(m.carrier) ?? null }))
      .sort((a, b) => (order.get(a.carrier) ?? 99) - (order.get(b.carrier) ?? 99)),
  } satisfies SellerOffer];
  }));
}

const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL'];

export interface CartAlternatives {
  /** Pro každou nabídku z košíku: nabídky téže karty ve stejném nebo lepším stavu a jazyce (včetně jí samé) */
  candidates: Record<string, Candidate[]>;
  terms: Record<string, ShippingTerms>;
  /** Nabídky z košíku, které už nejdou koupit (smazané, vyprodané, cena dohodou) */
  gone: string[];
  /** Kolik kusů nabídky z košíku ještě zbývá */
  stock: Record<string, number>;
}

/** Stejné karty u jiných prodejců, pro varianty košíku (nejlevněji, nejméně prodejců). */
export async function getCartAlternatives(listingIds: string[]): Promise<CartAlternatives> {
  const ids = listingIds.slice(0, 60);
  if (!ids.length) return { candidates: {}, terms: {}, gone: [], stock: {} };
  const supabase = await createClient();
  const [{ data: own }, user] = await Promise.all([
    supabase.from('listings').select('id, card_id, condition, language, quantity, price_czk').in('id', ids),
    getCurrentUser(),
  ]);
  // Stejný dotaz zároveň poví, které nabídky z košíku mezitím zmizely (košík je jen v prohlížeči).
  const originals = (own ?? []).filter((l) => l.quantity > 0 && l.price_czk != null);
  const gone = ids.filter((id) => !originals.some((l) => l.id === id));
  const stock = Object.fromEntries(originals.map((l) => [l.id, l.quantity as number]));
  const cardIds = [...new Set(originals.map((l) => l.card_id))];
  if (!cardIds.length) return { candidates: {}, terms: {}, gone, stock };
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
  return { candidates, terms, gone, stock };
}

/** Volba kupujícího u jednoho prodejce: doprava (dopravce nebo osobní předání), platba, výdejní místo a adresa. */
export interface SellerChoice { delivery: string; payment: PaymentMethod; point?: DeliveryPoint; address?: DeliveryAddress }

/** Adresa, kterou si kupující uložil pro příští nákupy (vidí ji jen on). */
export async function getSavedAddress(): Promise<DeliveryAddress | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('buyer_addresses').select('recipient, phone, street, city, zip, country').eq('user_id', user.id).maybeSingle();
  if (!data) return null;
  return { name: data.recipient, phone: data.phone ?? '', street: data.street ?? '', city: data.city ?? '', zip: data.zip ?? '', country: data.country === 'SK' ? 'SK' : 'CZ' };
}

/** Smaže uloženou adresu (Můj profil › Nastavení). */
export async function deleteSavedAddress(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const supabase = await createClient();
  await supabase.from('buyer_addresses').delete().eq('user_id', user.id);
  revalidatePath('/ucet/nastaveni');
}

export async function placeOrder(
  items: Array<{ listingId: string; quantity: number }>,
  choices: Record<string, SellerChoice>,
  save?: DeliveryAddress | null,
): Promise<PlaceOrderResult> {
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
  if (save) {
    // Jen když kupující zaškrtl Uložit adresu. Neúspěch objednávku nezdrží.
    const phone = save.phone.replace(/[^0-9+]/g, '');
    const zip = save.zip.replace(/\s/g, '');
    await supabase.from('buyer_addresses').upsert({
      user_id: user.id,
      recipient: save.name.trim().slice(0, 80),
      phone: /^\+?[0-9]{9,15}$/.test(phone) ? phone : null,
      street: save.street.trim().slice(0, 120) || null,
      city: save.city.trim().slice(0, 80) || null,
      zip: /^[0-9]{5}$/.test(zip) ? zip : null,
      country: save.country,
      updated_at: new Date().toISOString(),
    });
  }
  const origin = await siteOrigin();
  // Každý prodejce dostane e-mail o nové objednávce, odpověď kupujícímu kvůli tomu nezdržujeme.
  after(() => Promise.all(orderIds.map((id) => sendOrderEmail(supabase, id, 'requested', user.displayName, origin))));

  revalidatePath('/', 'layout');
  return { orderIds };
}
