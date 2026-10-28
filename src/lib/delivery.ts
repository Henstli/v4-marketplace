// Doprava a platba prodejce (DS DeliveryPayment). Kupující platí přímo prodejci, V4cards peníze nepřijímá.

export type Carrier = 'zasilkovna' | 'zasilkovna_home' | 'balikovna' | 'cp_doruky' | 'ppl' | 'ppl_point' | 'dpd' | 'gls' | 'letter' | 'custom';
/** Mapa výdejních míst, ze které kupující vybírá. */
export type PointProvider = 'zasilkovna' | 'balikovna' | 'ppl';
export type PaymentMethod = 'transfer' | 'cod' | 'cash';

/**
 * Dopravci v pořadí, v jakém je prodejce vidí v nastavení. `point`: kupující vybírá výdejní místo na mapě
 * dopravce, `home`: vyplní adresu. Stejné rozdělení má databázová funkce carrier_kind.
 */
export const CARRIERS: Array<{ key: Carrier; name: string; hint?: string; point?: PointProvider; home?: boolean }> = [
  { key: 'zasilkovna', name: 'Zásilkovna · výdejní místo a Z-BOX', hint: 'Kupující vybere místo na mapě v košíku.', point: 'zasilkovna' },
  { key: 'zasilkovna_home', name: 'Zásilkovna · na adresu', home: true },
  { key: 'balikovna', name: 'Balíkovna', hint: 'Kupující vybere místo na mapě v košíku.', point: 'balikovna' },
  { key: 'cp_doruky', name: 'Česká pošta · Balík Do ruky', home: true },
  { key: 'ppl_point', name: 'PPL · výdejní místo a box', hint: 'Kupující vybere místo na mapě v košíku.', point: 'ppl' },
  { key: 'ppl', name: 'PPL · na adresu', home: true },
  { key: 'dpd', name: 'DPD', home: true },
  { key: 'gls', name: 'GLS', home: true },
  { key: 'letter', name: 'Doporučený dopis', hint: 'Pro pár karet v obálce, bez sledování.', home: true },
  { key: 'custom', name: 'Vlastní způsob', hint: 'Název si napíšete sami.' },
];

/** Výdejní místo z mapy dopravce. */
export interface DeliveryPoint { id?: string; name: string; address?: string }

/** Příjemce a adresa. U výdejního místa stačí jméno a telefon. */
export interface DeliveryAddress { name: string; phone: string; street: string; city: string; zip: string; country: 'CZ' | 'SK' }

export const EMPTY_ADDRESS: DeliveryAddress = { name: '', phone: '', street: '', city: '', zip: '', country: 'CZ' };

export function carrierKind(carrier: string | null | undefined): 'point' | 'home' | null {
  const c = CARRIERS.find((x) => x.key === carrier);
  return c?.point ? 'point' : c?.home ? 'home' : null;
}

/** Stejná pravidla jako place_order: co v doručovacích údajích chybí (null = vše v pořádku). */
export function addressProblem(kind: 'point' | 'home' | null, a: DeliveryAddress, phoneOptional = false): string | null {
  if (!kind) return null;
  if (a.name.trim().length < 3) return 'jméno příjemce';
  const phone = a.phone.replace(/[^0-9+]/g, '');
  if (phone ? !/^\+?[0-9]{9,15}$/.test(phone) : !phoneOptional) return 'telefon';
  if (kind === 'home') {
    if (!a.street.trim()) return 'ulici';
    if (!a.city.trim()) return 'město';
    if (!/^[0-9]{5}$/.test(a.zip.replace(/\s/g, ''))) return 'PSČ';
  }
  return null;
}

export const CARRIER_NAME = Object.fromEntries(CARRIERS.map((c) => [c.key, c.name])) as Record<Carrier, string>;

export const PAYMENT_NAME: Record<PaymentMethod, string> = {
  transfer: 'předem',
  cod: 'dobírka',
  cash: 'hotově při předání',
};

// Strop ceny dopravy (DS DeliveryPayment): ceník dopravce + balné, dobírka ceník + 10 Kč.
// Stejná čísla jako shipping_packing_czk a cod_margin_czk v databázi.
export const SHIPPING_PACKING = 25;
export const COD_MARGIN = 10;

/** Ceník dopravce pro lidi (tabulka carrier_rates). `codFee` null = dobírku nehlídáme. */
export interface CarrierRate { price: number; codFee: number | null; heavy: number }

export interface ShippingMethod {
  carrier: Carrier;
  label: string | null;
  price: number;
  cod: boolean;
  codFee: number;
  /** Ceník dopravce (jen v košíku, u dopravců s ceníkem), aby kupující viděl, kolik je balné. */
  listPrice?: number | null;
}

/** Co prodejce nabízí kupujícím (veřejné údaje, bez čísla účtu). */
export interface PrepayKinds {
  bank: boolean;
  paypal: boolean;
  revolut: boolean;
}

export interface SellerOffer {
  pickup: boolean;
  pickupPlace: string | null;
  pickupRadius: number | null;
  /** Přesná adresa (obchod, pobočka), ne okruh */
  pickupExact: boolean;
  cashOnPickup: boolean;
  /** Platba předem: převod s vyplněným účtem, PayPal nebo Revolut. */
  transfer: boolean;
  /** Které způsoby předem prodejce má (štítky v košíku). */
  prepay: PrepayKinds;
  freeFrom: number | null;
  methods: ShippingMethod[];
}

export function methodName(m: { carrier: string; label: string | null }): string {
  return m.carrier === 'custom' ? m.label ?? 'Vlastní způsob' : CARRIER_NAME[m.carrier as Carrier] ?? m.carrier;
}

/** Tři body výzvy před vystavením. */
export function readiness(o: { named: boolean; pickup: boolean; cashOnPickup: boolean; transfer: boolean; methods: Array<{ cod: boolean }> }) {
  const delivery = o.pickup || o.methods.length > 0;
  const payment = o.transfer || (o.cashOnPickup && o.pickup) || o.methods.some((m) => m.cod);
  return { named: o.named, payment, delivery, ready: o.named && payment && delivery };
}

/** Způsoby platby, které jdou s danou dopravou. */
export function paymentsFor(offer: SellerOffer, delivery: string): Array<{ key: PaymentMethod; fee: number }> {
  const out: Array<{ key: PaymentMethod; fee: number }> = [];
  if (offer.transfer) out.push({ key: 'transfer', fee: 0 });
  if (delivery === 'pickup') {
    if (offer.cashOnPickup) out.push({ key: 'cash', fee: 0 });
  } else {
    const m = offer.methods.find((x) => x.carrier === delivery);
    if (m?.cod) out.push({ key: 'cod', fee: m.codFee });
  }
  return out;
}

/** Cena dopravy: doprava zdarma od částky platí jen pro dopravce, osobní předání je vždy zdarma. */
export function shippingPrice(offer: SellerOffer, delivery: string, subtotal: number): number {
  if (delivery === 'pickup') return 0;
  if (offer.freeFrom != null && subtotal >= offer.freeFrom) return 0;
  return offer.methods.find((m) => m.carrier === delivery)?.price ?? 0;
}

/** Jméno PayPal.Me z čehokoli, co prodejce vloží (celý odkaz, @jméno); null = neplatné. */
export function normalizePaypalMe(raw: string): string | null {
  const v = raw.trim().replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return /^[A-Za-z0-9]{1,20}$/.test(v) ? v : null;
}

/** Revtag bez zavináče, malými písmeny; null = neplatný. */
export function normalizeRevtag(raw: string): string | null {
  const v = raw.trim().replace(/^(https?:\/\/)?(www\.)?revolut\.me\//i, '').replace(/^@/, '').split(/[/?#]/)[0].toLowerCase();
  return /^[a-z0-9._]{3,30}$/.test(v) ? v : null;
}
