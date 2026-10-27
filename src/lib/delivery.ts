// Doprava a platba prodejce (DS DeliveryPayment). Kupující platí přímo prodejci, V4cards peníze nepřijímá.

export type Carrier = 'zasilkovna' | 'zasilkovna_home' | 'balikovna' | 'cp_doruky' | 'ppl' | 'dpd' | 'gls' | 'letter' | 'custom';
export type PaymentMethod = 'transfer' | 'cod' | 'cash';

/** Dopravci v pořadí, v jakém je prodejce vidí v nastavení. `point`: kupující vybírá výdejní místo. */
export const CARRIERS: Array<{ key: Carrier; name: string; hint?: string; point?: boolean }> = [
  { key: 'zasilkovna', name: 'Zásilkovna · výdejní místo a Z-BOX', hint: 'Kupující napíše výdejní místo v košíku.', point: true },
  { key: 'zasilkovna_home', name: 'Zásilkovna · na adresu' },
  { key: 'balikovna', name: 'Balíkovna', point: true },
  { key: 'cp_doruky', name: 'Česká pošta · Balík Do ruky' },
  { key: 'ppl', name: 'PPL' },
  { key: 'dpd', name: 'DPD' },
  { key: 'gls', name: 'GLS' },
  { key: 'letter', name: 'Doporučený dopis', hint: 'Pro pár karet v obálce, bez sledování.' },
  { key: 'custom', name: 'Vlastní způsob', hint: 'Název si napíšete sami.' },
];

export const CARRIER_NAME = Object.fromEntries(CARRIERS.map((c) => [c.key, c.name])) as Record<Carrier, string>;

export const PAYMENT_NAME: Record<PaymentMethod, string> = {
  transfer: 'převodem',
  cod: 'dobírka',
  cash: 'hotově při předání',
};

export interface ShippingMethod {
  carrier: Carrier;
  label: string | null;
  price: number;
  cod: boolean;
  codFee: number;
}

/** Co prodejce nabízí kupujícím (veřejné údaje, bez čísla účtu). */
export interface SellerOffer {
  pickup: boolean;
  pickupPlace: string | null;
  pickupRadius: number | null;
  cashOnPickup: boolean;
  /** Převod jde jen s vyplněným účtem. */
  transfer: boolean;
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
