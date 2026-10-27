// Kroky objednávky podle dopravy a platby (DS DeliveryPayment › Kroky objednávky).
// Stejná pravidla platí pro seznam, detail i bublinu ve zprávách; povolené změny hlídá databáze.
import { methodName, PAYMENT_NAME, type PaymentMethod } from './delivery';
import { ORDER_STATUS, ORDER_STATUS_SHORT, ORDER_TONE } from './order-status';

export interface FlowOrder {
  status: string;
  delivery: 'ship' | 'pickup';
  /** Prázdné u starších objednávek, ty se berou jako převod. */
  payment: PaymentMethod | null;
  /** Kupující klikl na Zaplaceno. */
  buyerPaidAt: string | null;
  /** Prodejce navrhl vyšší dopravu, čeká se na kupujícího. */
  shipChange?: number | null;
}

type Role = 'buyer' | 'seller';
type Tone = 'ok' | 'warn' | 'muted' | 'danger' | 'info';
export type StepKey = 'ordered' | 'confirmed' | 'buyer_paid' | 'paid' | 'shipped' | 'delivered';

const pay = (o: FlowOrder): PaymentMethod => o.payment ?? 'transfer';
const AFTER_CONFIRM = new Set(['confirmed', 'paid', 'shipped', 'delivered']);
const AFTER_PAID = new Set(['paid', 'shipped', 'delivered']);

/** Kroky v pořadí, s tím, jestli jsou hotové, a čím se na ně čeká. */
export function flowSteps(o: FlowOrder): Array<{ key: StepKey; label: string; done: boolean; waiting: string }> {
  const p = pay(o);
  const pickup = o.delivery === 'pickup';
  const steps: Array<{ key: StepKey; label: string; done: boolean; waiting: string }> = [
    { key: 'ordered', label: 'Objednáno', done: true, waiting: '' },
    { key: 'confirmed', label: 'Potvrzeno', done: AFTER_CONFIRM.has(o.status), waiting: 'čeká na prodejce' },
  ];
  if (p === 'transfer') {
    steps.push(
      { key: 'buyer_paid', label: 'Zaplaceno', done: !!o.buyerPaidAt || AFTER_PAID.has(o.status), waiting: 'čeká na platbu' },
      { key: 'paid', label: 'Platba přišla', done: AFTER_PAID.has(o.status), waiting: 'prodejce zkontroluje účet' },
    );
  }
  if (!pickup) steps.push({ key: 'shipped', label: 'Odesláno', done: o.status === 'shipped' || o.status === 'delivered', waiting: 'čeká na odeslání' });
  steps.push(p === 'cash'
    ? { key: 'delivered', label: 'Předáno', done: o.status === 'delivered', waiting: 'čeká na předání' }
    : { key: 'delivered', label: 'Převzato', done: o.status === 'delivered', waiting: pickup ? 'čeká na předání' : 'čeká na doručení' });
  return steps;
}

/** Štítek stavu, který říká, kdo je na tahu. `short` pro bublinu ve zprávách. */
export function orderLabel(o: FlowOrder, role: Role, short = false): { text: string; tone: Tone } {
  const p = pay(o);
  const seller = role === 'seller';
  const pickup = o.delivery === 'pickup';
  if (o.status === 'requested' && o.shipChange != null && !seller) return { text: 'Změna dopravy · potvrďte', tone: 'warn' };
  if (o.status === 'confirmed') {
    if (o.shipChange != null) return seller ? { text: 'Změna dopravy · čeká na kupujícího', tone: 'info' } : { text: 'Změna dopravy · potvrďte', tone: 'warn' };
    if (p === 'transfer') {
      if (!o.buyerPaidAt) return { text: seller ? 'Potvrzeno · čeká na platbu' : 'Potvrzeno · zaplaťte', tone: 'info' };
      return seller ? { text: 'Zaplaceno · zkontrolujte', tone: 'warn' } : { text: 'Zaplaceno · čeká na prodejce', tone: 'info' };
    }
    if (p === 'cod') return { text: seller ? 'Potvrzeno · odešlete' : 'Potvrzeno · čeká na odeslání', tone: 'info' };
    return { text: 'Potvrzeno · domluvte předání', tone: 'info' };
  }
  if (o.status === 'paid') {
    if (pickup) return { text: seller ? 'Zaplaceno · předejte' : 'Zaplaceno · domluvte předání', tone: 'info' };
    return { text: seller ? 'Zaplaceno · odešlete' : 'Zaplaceno · čeká na odeslání', tone: 'info' };
  }
  if (o.status === 'delivered') return { text: pickup ? 'Předáno' : 'Převzato', tone: 'ok' };
  return { text: (short ? ORDER_STATUS_SHORT : ORDER_STATUS)[o.status] ?? o.status, tone: ORDER_TONE[o.status] ?? 'muted' };
}

/** Věta „Co dál“ v detailu. */
export function nextStep(o: FlowOrder, role: Role): string | null {
  const p = pay(o);
  const seller = role === 'seller';
  const pickup = o.delivery === 'pickup';
  switch (o.status) {
    case 'requested':
      if (o.shipChange != null) return seller ? 'Navrhli jste vyšší dopravu. Po potvrzení ji kupující musí odsouhlasit, než uvidí QR kód.' : 'Prodejce navrhl vyšší cenu dopravy. Souhlaste, nebo objednávku zrušte bez následků.';
      return seller ? 'Potvrďte, že karty máte a prodáte je, nebo objednávku odmítněte.' : 'Prodejce objednávku potvrdí nebo odmítne. Karty jsou zatím rezervované pro vás.';
    case 'confirmed':
      if (o.shipChange != null) return seller ? 'Kupující musí potvrdit novou cenu dopravy. Do té doby nevidí QR kód.' : 'Prodejce upravil cenu dopravy. Souhlaste, nebo objednávku zrušte bez následků.';
      if (p === 'transfer') {
        if (!o.buyerPaidAt) return seller ? 'Kupující zaplatí převodem. Jakmile peníze uvidíte na účtu, klikněte na Platba přišla.' : 'Zaplaťte převodem nebo QR kódem a klikněte na Zaplaceno.';
        return seller ? 'Kupující píše, že zaplatil. Zkontrolujte účet: Platba přišla, nebo Nepřišla.' : 'Prodejce zkontroluje, že platba dorazila.';
      }
      if (p === 'cod') return seller ? 'Odešlete kartu na dobírku a klikněte na Odesláno.' : 'Prodejce kartu odešle na dobírku. Zaplatíte při převzetí.';
      return seller ? 'Domluvte předání ve zprávách. Až dostanete peníze a kartu předáte, klikněte na Předáno.' : 'Domluvte s prodejcem předání ve zprávách. Platíte hotově na místě.';
    case 'paid':
      if (pickup) return seller ? 'Platba přišla. Domluvte předání, kupující pak klikne na Převzato.' : 'Platba přišla. Domluvte předání a po převzetí klikněte na Převzato.';
      return seller ? 'Platba přišla. Odešlete kartu a klikněte na Odesláno.' : 'Platba přišla, prodejce kartu odešle.';
    case 'shipped':
      return seller ? 'Kupující klikne na Převzato, až karta dorazí.' : 'Karta je na cestě. Až dorazí, klikněte na Převzato.';
    case 'delivered':
      return seller ? 'Hotovo, karta je předaná.' : 'Hotovo. Ohodnoťte prosím prodejce.';
    default:
      return null;
  }
}

export type FlowAction =
  | { op: 'status'; status: string; label: string; variant: 'primary' | 'secondary' | 'ghost'; tracking?: boolean }
  | { op: 'mark_paid' | 'not_received' | 'ship_accept' | 'ship_reject'; label: string; variant: 'primary' | 'secondary' | 'ghost' };

/** Tlačítka podle role a stavu, co nejkratší (Šimon 27. 10.). Hlavní akce první. */
export function flowActions(o: FlowOrder, role: Role): FlowAction[] {
  const p = pay(o);
  const pickup = o.delivery === 'pickup';
  const out: FlowAction[] = [];
  // Čekající změna dopravy: kupující souhlasí nebo zruší, prodejce může jen zrušit.
  if ((o.status === 'confirmed' || (o.status === 'requested' && role === 'buyer')) && o.shipChange != null) {
    return role === 'buyer'
      ? [{ op: 'ship_accept', label: 'Souhlasím', variant: 'primary' }, { op: 'ship_reject', label: 'Zrušit objednávku', variant: 'ghost' }]
      : [{ op: 'status', status: 'cancelled', label: 'Zrušit', variant: 'ghost' }];
  }
  if (role === 'buyer') {
    if (o.status === 'requested') out.push({ op: 'status', status: 'cancelled', label: 'Zrušit objednávku', variant: 'ghost' });
    if (o.status === 'confirmed' && p === 'transfer' && !o.buyerPaidAt) out.push({ op: 'mark_paid', label: 'Zaplaceno', variant: 'primary' });
    if (o.status === 'shipped' || (o.status === 'paid' && pickup)) out.push({ op: 'status', status: 'delivered', label: 'Převzato', variant: 'primary' });
    return out;
  }
  if (o.status === 'requested') {
    out.push({ op: 'status', status: 'confirmed', label: 'Potvrdit objednávku', variant: 'primary' });
    out.push({ op: 'status', status: 'declined', label: 'Odmítnout', variant: 'ghost' });
  }
  if (o.status === 'confirmed' && p === 'transfer') {
    out.push({ op: 'status', status: 'paid', label: 'Platba přišla', variant: o.buyerPaidAt ? 'primary' : 'secondary' });
    if (o.buyerPaidAt) out.push({ op: 'not_received', label: 'Nepřišla', variant: 'ghost' });
  }
  if (!pickup && ((o.status === 'paid' && p === 'transfer') || (o.status === 'confirmed' && p === 'cod'))) {
    out.push({ op: 'status', status: 'shipped', label: 'Odesláno', variant: 'primary', tracking: true });
  }
  if (o.status === 'confirmed' && p === 'cash' && pickup) out.push({ op: 'status', status: 'delivered', label: 'Předáno', variant: 'primary' });
  if (o.status === 'confirmed') out.push({ op: 'status', status: 'cancelled', label: 'Zrušit', variant: 'ghost' });
  return out;
}

/** Smí prodejce upravit dopravu? U zásilky od objednání (i před potvrzením) do zaplacení. */
export function canChangeShipping(o: FlowOrder): boolean {
  return (o.status === 'requested' || o.status === 'confirmed') && o.delivery === 'ship' && !o.buyerPaidAt;
}

/** Krátký popis dopravy a platby, např. „Zásilkovna · výdejní místo a Z-BOX · dobírka“. */
export function deliveryLine(o: { delivery: 'ship' | 'pickup'; payment: PaymentMethod | null; carrier: string | null; carrier_label: string | null }): string {
  const how = o.delivery === 'pickup' ? 'osobní předání' : o.carrier ? methodName({ carrier: o.carrier, label: o.carrier_label }) : 'doprava';
  return o.payment ? `${how} · ${PAYMENT_NAME[o.payment]}` : how;
}

// Sledování zásilky u dopravců, kteří mají veřejnou stránku podle čísla.
const TRACK: Record<string, (code: string) => string> = {
  zasilkovna: (c) => `https://tracking.packeta.com/cs/?id=${c}`,
  zasilkovna_home: (c) => `https://tracking.packeta.com/cs/?id=${c}`,
  balikovna: (c) => `https://www.postaonline.cz/trackandtrace/-/zasilka/cislo?parcelNumbers=${c}`,
  cp_doruky: (c) => `https://www.postaonline.cz/trackandtrace/-/zasilka/cislo?parcelNumbers=${c}`,
  letter: (c) => `https://www.postaonline.cz/trackandtrace/-/zasilka/cislo?parcelNumbers=${c}`,
  ppl: (c) => `https://www.ppl.cz/vyhledat-zasilku?shipmentId=${c}`,
  dpd: (c) => `https://tracking.dpd.de/status/cs_CZ/parcel/${c}`,
  gls: (c) => `https://gls-group.com/CZ/cs/sledovani-zasilek?match=${c}`,
};

export function trackingUrl(carrier: string | null, code: string | null): string | null {
  if (!carrier || !code || !TRACK[carrier]) return null;
  return TRACK[carrier](encodeURIComponent(code));
}
