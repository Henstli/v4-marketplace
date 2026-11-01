import Link from 'next/link';
import QRCode from 'qrcode';
import { Button, CardThumb, Price, Status } from '@/components/trezor';
import { formatDate, formatDateTime } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { methodName, SHIPPING_PACKING, type PaymentMethod } from '@/lib/delivery';
import { CancelLock } from '@/components/orders/CancelLock';
import { CancelRequestBlock } from '@/components/orders/CancelRequest';
import { ReportStrip } from '@/components/reports/ReportStrip';
import { cancelFrom, canChangeShipping, canSellerCancel, deliveryLine, flowActions, orderLabel, trackingUrl, type FlowAction, type FlowOrder, type PaidVia } from '@/lib/order-flow';
import { PaidButton } from '@/components/orders/PaidButton';
import { PaidViaRow } from '@/components/orders/PaidViaRow';
import { czAccountNumber, formatIban, spayd } from '@/lib/payment';
import { fetchPrepay, type PrepayRow } from '@/lib/prepay';
import type { createClient } from '@/lib/supabase/server';
import { CopyButton } from '@/components/orders/CopyButton';
import { ExpiryStatus } from '@/components/orders/Expiry';
import { PrepayTabs } from '@/components/orders/PrepayTabs';
import { SellerRestrictedNotice } from '@/components/orders/SellerRestricted';
import { ShipChangeBlock } from '@/components/orders/ShipChange';
import { addReview, setOrderStatus } from './actions';
import { ShipEdit } from './ShipEdit';
import styles from './orders.module.css';

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Stavy, ve kterých si strany vidí kontakt a domlouvají platbu a předání.
export const AGREED = new Set(['confirmed', 'paid', 'shipped', 'delivered']);
// Skončené bez obchodu.
export const ENDED = new Set(['cancelled', 'declined', 'expired']);

export const ORDER_SELECT = 'id, buyer_id, seller_id, status, number, delivery, expires_at, total_czk, shipping_czk, created_at, payment, carrier, carrier_label, pickup_point, ship_city, cod_fee_czk, buyer_paid_at, paid_via, not_received_at, buyer_insist_at, cancel_request_at, cancel_rejected_at, cancel_agreed, delivered_at, tracking, ship_change_czk, ship_change_reason, decided_at, decline_reason, order_items(quantity, price_czk, condition, cards(name, slug, image_url, game_id, number, card_sets(code)))';

export interface OrderRow {
  id: string;
  // Prázdné, když druhá strana smazala účet.
  buyer_id: string | null;
  seller_id: string | null;
  status: string;
  number: number;
  delivery: 'ship' | 'pickup';
  expires_at: string | null;
  total_czk: number;
  shipping_czk: number;
  created_at: string;
  payment: PaymentMethod | null;
  carrier: string | null;
  carrier_label: string | null;
  pickup_point: string | null;
  /** Město doručení na adresu (zůstane i po smazání adresy). */
  ship_city: string | null;
  cod_fee_czk: number;
  buyer_paid_at: string | null;
  paid_via: PaidVia | null;
  /** Prodejce klikl na Nepřišla, kupující potvrdil odeslání, prodejce žádá o zrušení (DS Reports). */
  not_received_at: string | null;
  buyer_insist_at: string | null;
  cancel_request_at: string | null;
  cancel_rejected_at: string | null;
  /** Zrušeno se souhlasem kupujícího (nepočítá se prodejci). */
  cancel_agreed: boolean;
  delivered_at: string | null;
  tracking: string | null;
  /** Prodejce navrhl vyšší dopravu, čeká na kupujícího. */
  ship_change_czk: number | null;
  ship_change_reason: string | null;
  /** Kdy prodejce potvrdil nebo odmítl. */
  decided_at: string | null;
  /** Důvod odmítnutí pro kupujícího (DS Orders › Odmítnout). */
  decline_reason: string | null;
  /** Prodejce je pozastavený a kupující ještě nezaplatil (doplní markSellerRestricted). */
  seller_restricted?: boolean;
  order_items: Array<{ quantity: number; price_czk: number; condition: string | null; cards: { name: string; slug: string; image_url: string | null; game_id: string | null; number?: string | null; card_sets?: { code: string | null } | null } | null }>;
}

export type Payment = PrepayRow & { qr: string | null };

/** E-mail druhé strany (databáze ho vrací jen účastníkům potvrzené objednávky). */
export async function loadContact(supabase: Supabase, o: OrderRow): Promise<string | null> {
  if (!AGREED.has(o.status) || o.status === 'delivered') return null;
  const { data } = await supabase.rpc('order_counterpart', { target: o.id });
  return (data as Array<{ email: string | null }> | null)?.[0]?.email ?? null;
}

/** Doručovací údaje (databáze je prodejci vrátí až po potvrzení, 30 dní po uzavření je smaže). */
export interface DeliveryRow {
  order_id: string;
  recipient: string;
  phone: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  country: string | null;
  point_id: string | null;
  point_name: string | null;
  point_address: string | null;
}

export async function loadDeliveries(supabase: Supabase, ids: string[]): Promise<Map<string, DeliveryRow>> {
  if (!ids.length) return new Map();
  const { data } = await supabase.from('order_delivery').select('order_id, recipient, phone, street, city, zip, country, point_id, point_name, point_address').in('order_id', ids);
  return new Map(((data ?? []) as DeliveryRow[]).map((d) => [d.order_id, d]));
}

const zipText = (z: string | null) => (z ?? '').replace(/^(\d{3})(\d{2})$/, '$1 $2');

/** Kam zásilku poslat (DS DeliveryPayment › Prodejce: kam poslat), s tlačítky Kopírovat. */
export function DeliveryBox({ d, o, role, compact }: { d?: DeliveryRow | null; o: OrderRow; role: 'buyer' | 'seller'; compact?: boolean }) {
  if (!d) {
    // Prodejce před potvrzením vidí jen město nebo výdejní místo.
    if (role === 'seller' && o.status === 'requested' && (o.ship_city || o.pickup_point)) {
      return <p className="t-small muted">Adresu a telefon kupujícího uvidíte po potvrzení objednávky.</p>;
    }
    return null;
  }
  const address = d.point_name
    ? [d.point_name, d.point_address].filter(Boolean).join(', ')
    : `${d.street}, ${zipText(d.zip)} ${d.city}${d.country === 'SK' ? ', Slovensko' : ''}`;
  const all = [d.recipient, address, d.point_id ? `ID ${d.point_id}` : null, d.phone].filter(Boolean).join('\n');
  const rows: Array<[string, string]> = d.point_name
    ? [['Místo', d.point_name], ...(d.point_address ? [['Adresa', d.point_address] as [string, string]] : []), ...(d.point_id ? [['ID místa', d.point_id] as [string, string]] : []), ['Příjemce', d.recipient], ...(d.phone ? [['Telefon', d.phone] as [string, string]] : [])]
    : [['Jméno', d.recipient], ['Adresa', address], ...(d.phone ? [['Telefon', d.phone] as [string, string]] : [])];
  const title = role === 'seller' ? 'Kam poslat' : 'Doručení';
  return (
    <div className={styles.deliveryBox}>
      <div className={styles.deliveryHead}>
        <span className="t-label muted">{title.toUpperCase()}</span>
        {role === 'seller' ? <CopyButton text={all} label={d.point_name ? 'Kopírovat vše' : 'Kopírovat celou adresu'} /> : null}
      </div>
      {compact ? (
        <p className="t-small">{d.recipient} · {address}{d.point_id ? <> · <span className="code">ID {d.point_id}</span></> : null}{d.phone ? <> · <span className="code">{d.phone}</span></> : null}</p>
      ) : (
        <dl className={styles.deliveryRows}>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="t-small muted">{k}</dt>
              <dd className={k === 'ID místa' || k === 'Telefon' ? 'code' : undefined}>{v}</dd>
              {role === 'seller' ? <CopyButton text={v} /> : null}
            </div>
          ))}
        </dl>
      )}
      {role === 'seller' ? (
        <p className="t-small muted">Zásilku podáte pod svým účtem u dopravce. Údaje použijte jen k odeslání této objednávky, 30 dní po jejím uzavření se smažou.</p>
      ) : null}
    </div>
  );
}

/** Platba předem (účet a QR, PayPal, Revolut) pro potvrzenou objednávku. */
export async function loadPayment(supabase: Supabase, o: OrderRow): Promise<Payment | null> {
  if (o.status !== 'confirmed' || (o.payment ?? 'transfer') !== 'transfer') return null;
  const p = await fetchPrepay(supabase, o.id);
  if (!p) return null;
  const qr = p.iban?.startsWith('CZ') && p.account_name
    ? await QRCode.toString(spayd({ iban: p.iban, amount: p.amount, vs: p.vs, name: p.account_name }), { type: 'svg', margin: 1, width: 160 })
    : null;
  return { ...p, qr };
}

/** Objednávka pro pravidla kroků (DS DeliveryPayment). */
export const flowOf = (o: OrderRow): FlowOrder => ({ status: o.status, delivery: o.delivery, payment: o.payment, buyerPaidAt: o.buyer_paid_at, paidVia: o.paid_via, notReceivedAt: o.not_received_at, buyerInsistAt: o.buyer_insist_at, cancelRequestAt: o.cancel_request_at, cancelRejectedAt: o.cancel_rejected_at, shipChange: o.ship_change_czk, total: o.total_czk, shipping: o.shipping_czk, sellerRestricted: o.seller_restricted });

/** Řádek PLATBA, když kupující napsal, jak zaplatil (DS OrderPayment › Jak jste zaplatili). */
export function PaidViaInfo({ o, role }: { o: OrderRow; role: 'buyer' | 'seller' }) {
  if (!o.paid_via || !o.buyer_paid_at || !['confirmed', 'paid', 'shipped'].includes(o.status)) return null;
  return <PaidViaRow via={o.paid_via} at={o.buyer_paid_at} amount={o.total_czk} role={role} pending={o.status === 'confirmed'} notReceived={!!o.not_received_at} insistAt={o.buyer_insist_at} />;
}

/** Označí objednávky kupujícího, kde je prodejce pozastavený a kupující ještě neklikl Zaplaceno. */
export async function markSellerRestricted(supabase: Supabase, orders: OrderRow[]): Promise<void> {
  const ids = orders.filter((o) => (o.status === 'requested' || o.status === 'confirmed') && !o.buyer_paid_at).map((o) => o.id);
  if (!ids.length) return;
  const { data } = await supabase.rpc('orders_seller_restricted', { p_orders: ids });
  const hit = new Set((data ?? []) as string[]);
  for (const o of orders) o.seller_restricted = hit.has(o.id);
}

/** Akce kupujícího podle stavu (stejné na seznamu, v detailu i v chatu). */
export function BuyerActions({ o, reviewed }: { o: OrderRow; reviewed: boolean }) {
  return (
    <>
      <PaidViaInfo o={o} role="buyer" />
      {o.seller_restricted ? <SellerRestrictedNotice /> : null}
      <CancelBlocks o={o} role="buyer" />
      {flowActions(flowOf(o), 'buyer').map((a) => <FlowButton key={a.label} id={o.id} action={a} />)}
      {!reviewed ? <ReviewForm o={o} /> : null}
      {reviewed && canReview(o) ? <p className="t-small muted">Prodejce jste ohodnotili, děkujeme.</p> : null}
    </>
  );
}

/** Akce prodejce podle stavu. `shipCap`: strop úpravy dopravy podle ceníku dopravce (null = bez stropu). */
export function SellerActions({ o, shipCap }: { o: OrderRow; shipCap?: number | null }) {
  return (
    <>
      <PaidViaInfo o={o} role="seller" />
      {canChangeShipping(flowOf(o)) ? (
        <ShipEdit
          key={o.ship_change_czk ?? o.shipping_czk}
          id={o.id}
          carrier={o.carrier ? methodName({ carrier: o.carrier, label: o.carrier_label }) : 'Doprava'}
          shipping={o.ship_change_czk ?? o.shipping_czk}
          total={o.total_czk - o.shipping_czk + (o.ship_change_czk ?? o.shipping_czk)}
          cap={shipCap ?? null}
        />
      ) : null}
      <CancelBlocks o={o} role="seller" />
      {flowActions(flowOf(o), 'seller').map((a) => <FlowButton key={a.label} id={o.id} action={a} />)}
    </>
  );
}

/** Žádost o zrušení a odkdy prodejce smí zrušit objednávku označenou jako zaplacenou (po Nepřišla), pro obě strany. */
export function CancelBlocks({ o, role }: { o: OrderRow; role: 'buyer' | 'seller' }) {
  if (o.status !== 'confirmed' || !o.not_received_at) return null;
  const f = flowOf(o);
  return (
    <>
      <CancelRequestBlock role={role} requestedAt={o.cancel_request_at} rejectedAt={o.cancel_rejected_at} />
      {canSellerCancel(f) ? null : <CancelLock from={o.buyer_insist_at ?? o.not_received_at} until={cancelFrom(f)!.toISOString()} role={role} />}
    </>
  );
}

/** Hodnocení prodejce: po převzetí, nebo když prodejce zrušil po Zaplaceno bez souhlasu (DS Reports › Hodnocení). */
export const canReview = (o: OrderRow) =>
  !!o.seller_id && (o.status === 'delivered' || (o.status === 'cancelled' && !!o.buyer_paid_at && !o.cancel_agreed));

export function ReviewForm({ o }: { o: OrderRow }) {
  if (!canReview(o)) return null;
  return (
    <form action={addReview} className={styles.review}>
      <input type="hidden" name="orderId" value={o.id} />
      <input type="hidden" name="sellerId" value={o.seller_id!} />
      {o.status === 'cancelled' ? <p className="t-small">Zaplatili jste, ale prodejce objednávku zrušil. Můžete ho ohodnotit. U prodejce se hodnocení zobrazí se štítkem „Zrušeno po zaplacení“.</p> : null}
      <label className={styles.field}>
        <span className="t-label muted">HODNOCENÍ</span>
        <select name="rating" defaultValue={o.status === 'cancelled' ? '1' : '5'} className={styles.input}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}{'☆'.repeat(5 - n)} ({n})</option>)}
        </select>
      </label>
      <label className={`${styles.field} ${styles.grow}`}>
        <span className="t-label muted">KOMENTÁŘ (NEPOVINNÝ)</span>
        <input name="comment" maxLength={500} className={styles.input} placeholder={o.status === 'cancelled' ? 'Co se stalo?' : 'Jak proběhl nákup?'} />
      </label>
      <Button type="submit" variant="secondary">Ohodnotit prodejce</Button>
    </form>
  );
}

/** Strop úpravy dopravy pro každého dopravce: ceník větší zásilky + balné (tabulka carrier_rates). */
export async function loadShipCaps(supabase: Supabase): Promise<Map<string, number>> {
  const { data } = await supabase.from('carrier_rates').select('carrier, price_czk, heavy_czk');
  return new Map((data ?? []).map((r) => [r.carrier as string, Math.max(r.heavy_czk as number, r.price_czk as number) + SHIPPING_PACKING]));
}

/** Čekající změna dopravy: původní a nová cena a důvod (kupující i prodejce). */
export function ShipChangeNotice({ o, role }: { o: OrderRow; role: 'buyer' | 'seller' }) {
  if ((o.status !== 'requested' && o.status !== 'confirmed') || o.ship_change_czk == null) return null;
  return (
    <ShipChangeBlock
      shipping={o.shipping_czk}
      change={o.ship_change_czk}
      total={o.total_czk}
      reason={o.ship_change_reason}
      role={role}
      requested={o.status === 'requested'}
      transfer={(o.payment ?? 'transfer') === 'transfer'}
    />
  );
}

/** Jedno tlačítko kroku; u Odesláno i nepovinné číslo zásilky. */
export function FlowButton({ id, action }: { id: string; action: FlowAction }) {
  const tracking = action.op === 'status' && action.tracking;
  if (action.op === 'mark_paid') return <PaidButton id={id} label={action.label} className={styles.flowForm} />;
  return (
    <form action={setOrderStatus} className={tracking ? `${styles.flowForm} ${styles.trackForm}` : styles.flowForm}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={action.op} />
      {action.op === 'status' ? <input type="hidden" name="status" value={action.status} /> : null}
      {tracking ? <input name="tracking" maxLength={60} className={`${styles.input} code`} placeholder="Číslo zásilky (nepovinné)" aria-label="Číslo zásilky" /> : null}
      <Button type="submit" variant={action.variant === 'primary' ? undefined : action.variant}>{action.label}</Button>
    </form>
  );
}

/** Doprava, výdejní místo a číslo zásilky jedním řádkem. */
export function DeliveryInfo({ o }: { o: OrderRow }) {
  const url = trackingUrl(o.carrier, o.tracking);
  return (
    <p className="t-small muted">
      {deliveryLine(o)}
      {o.pickup_point ? <> · výdejní místo {o.pickup_point}</> : o.ship_city ? <> · {o.ship_city}</> : null}
      {o.tracking ? <> · zásilka {url ? <a href={url} target="_blank" rel="noreferrer" className="code">{o.tracking}</a> : <span className="code">{o.tracking}</span>}</> : null}
    </p>
  );
}

export function OrderCard({ order, counterpart, contact, payment, delivery, role, report, children }: {
  order: OrderRow;
  counterpart: string;
  contact?: string | null;
  payment?: Payment | null;
  delivery?: DeliveryRow | null;
  role: 'buyer' | 'seller';
  /** Číslo otevřeného hlášení („Objednávku prošetřujeme“). */
  report?: number | null;
  children?: React.ReactNode;
}) {
  const counterpartId = role === 'buyer' ? order.seller_id : order.buyer_id;
  const label = orderLabel(flowOf(order), role);
  return (
    <article className={styles.order} id={`objednavka-${order.number}`} data-tone={label.tone}>
      <div className={styles.head}>
        <div>
          {order.status === 'requested' && order.expires_at ? (
            <ExpiryStatus expiresAt={order.expires_at} role={role} className={styles.status} />
          ) : (
            <Status tone={label.tone} className={styles.status}>{label.text}</Status>
          )}
          <p className="t-small muted">
            <Link href={`/objednavky/${order.number}`} className={styles.title}>Objednávka č. <span className="code">{order.number}</span></Link>
            {' · '}{counterpart} · {formatDate(order.created_at)}
          </p>
          <DeliveryInfo o={order} />
        </div>
        <Price amount={order.total_czk} />
      </div>
      <ul className={styles.items}>
        {order.order_items.map((i, n) => (
          <li key={n}>
            <CardThumb
              image={thumbUrl(i.cards?.image_url ?? undefined)}
              preview={i.cards?.image_url ?? undefined}
              color={i.cards?.game_id ? `var(--game-${i.cards.game_id}-art)` : undefined}
            />
            {i.cards ? <Link href={`/karty/${i.cards.slug}`}>{i.cards.name}</Link> : 'Karta'}
            {i.condition ? <> <span className="code">{i.condition}</span></> : null}
            <span className="muted"> · {i.quantity}&nbsp;ks</span>
            <Price amount={i.price_czk * i.quantity} />
          </li>
        ))}
        <li className="muted">{order.delivery === 'pickup' ? 'Osobní předání' : 'Doprava'} <Price amount={order.shipping_czk} /></li>
        {order.cod_fee_czk ? <li className="muted">Příplatek za dobírku <Price amount={order.cod_fee_czk} /></li> : null}
      </ul>
      {order.status === 'requested' && order.expires_at ? (
        <p className="t-small muted">
          {role === 'seller' ? 'Potvrďte nebo odmítněte do' : 'Prodejce potvrdí nejpozději'} {formatDateTime(order.expires_at)}.
          {role === 'seller' ? ' Potom objednávka vyprší a karty se vrátí do nabídky.' : ' Karty jsou zatím rezervované pro vás.'}
        </p>
      ) : null}
      {report ? <ReportStrip number={report} /> : null}
      <ShipChangeNotice o={order} role={role} />
      {!ENDED.has(order.status) && order.status !== 'delivered' ? <DeliveryBox d={delivery} o={order} role={role} compact /> : null}
      <PaymentInfo payment={payment} role={role} order={order} />
      {contact ? (
        <p className="t-small">
          {role === 'buyer' ? 'Kontakt na prodejce: ' : 'Kontakt na kupujícího: '}
          <a href={`mailto:${contact}`}>{contact}</a>
          <span className="muted">
            {role === 'buyer' ? ' · Platíte přímo prodejci. V4cards peníze nepřijímá.' : ''}
          </span>
        </p>
      ) : null}
      {counterpartId ? (
        <p className="t-small">
          <Link href={`/zpravy/${counterpartId}`}>{role === 'buyer' ? 'Napsat prodejci' : 'Napsat kupujícímu'}</Link>
          <span className="muted"> · Ve zprávách najdete i celou historii objednávek mezi vámi.</span>
        </p>
      ) : null}
      {children ? <div className={styles.actions}>{children}</div> : null}
    </article>
  );
}

/** Platba předem (DS OrderPayment): QR převod, PayPal, Revolut; jen před zaplacením, nebo věta, co chybí. */
export function PaymentInfo({ payment, role, order }: { payment?: Payment | null; role: 'buyer' | 'seller'; order: OrderRow }) {
  const transfer = (order.payment ?? 'transfer') === 'transfer';
  if (order.status !== 'confirmed' || !transfer || order.ship_change_czk != null) return null;
  // Po kliknutí na Zaplaceno už QR kupujícímu nepřekáží, prodejce ho vidí dál.
  if (role === 'buyer' && order.buyer_paid_at) return null;
  return (
    <>
      {payment ? (
        <div className={styles.payment}>
          <PrepayTabs
            role={role}
            amount={payment.amount}
            vs={payment.vs}
            paypalMe={payment.paypal_me}
            revtag={payment.revtag}
            bank={payment.iban ? (
              <div className={styles.bank}>
                {payment.qr ? <div className={styles.qr} dangerouslySetInnerHTML={{ __html: payment.qr }} aria-label="QR platba" role="img" /> : null}
                <dl className={styles.payLines}>
                  <div><dt className="t-label muted">ÚČET</dt><dd className="code">{czAccountNumber(payment.iban) ?? formatIban(payment.iban)}</dd></div>
                  {payment.iban.startsWith('CZ') ? <div className={styles.wide}><dt className="t-label muted">IBAN</dt><dd className="code">{formatIban(payment.iban)}</dd></div> : null}
                  <div><dt className="t-label muted">MAJITEL</dt><dd>{payment.account_name}</dd></div>
                  <div><dt className="t-label muted">ČÁSTKA</dt><dd><Price amount={payment.amount} /></dd></div>
                  <div><dt className="t-label muted">VARIABILNÍ SYMBOL</dt><dd className="code">{payment.vs}</dd></div>
                </dl>
              </div>
            ) : null}
          />
          <p className="t-small muted">
            {role === 'buyer'
              ? 'Platíte přímo prodejci. Po odeslání platby klikněte na Zaplaceno.'
              : 'Tyto údaje vidí kupující. Kartu odešlete, až platba dorazí na váš účet.'}
          </p>
        </div>
      ) : role === 'buyer' ? (
        <p className="t-small muted">Prodejce nemá vyplněnou platbu předem. Napište mu ve zprávách, kam zaplatit.</p>
      ) : (
        <p className="t-small muted">
          Kupující neví, kam platit. <Link href="/ucet/nastaveni#doprava-platba">Doplňte účet, PayPal nebo Revolut</Link> a uvidí je u objednávky.
        </p>
      )}
    </>
  );
}
