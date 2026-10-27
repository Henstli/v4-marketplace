import Link from 'next/link';
import QRCode from 'qrcode';
import { Button, CardThumb, Price, Status } from '@/components/trezor';
import { formatDate, formatDateTime } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { ORDER_STATUS as STATUS, ORDER_TONE } from '@/lib/order-status';
import { czAccountNumber, formatIban, spayd } from '@/lib/payment';
import type { createClient } from '@/lib/supabase/server';
import { ExpiryStatus } from '@/components/orders/Expiry';
import { addReview, setOrderStatus } from './actions';
import styles from './orders.module.css';

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Stavy, ve kterých si strany vidí kontakt a domlouvají platbu a předání.
export const AGREED = new Set(['confirmed', 'paid', 'shipped', 'delivered']);
// Skončené bez obchodu.
export const ENDED = new Set(['cancelled', 'declined', 'expired']);

export const ORDER_SELECT = 'id, buyer_id, seller_id, status, number, delivery, expires_at, total_czk, shipping_czk, created_at, order_items(quantity, price_czk, condition, cards(name, slug, image_url, game_id))';

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
  order_items: Array<{ quantity: number; price_czk: number; condition: string | null; cards: { name: string; slug: string; image_url: string | null; game_id: string | null } | null }>;
}

interface PaymentRow { iban: string; account_name: string; amount: number; vs: number }
export type Payment = PaymentRow & { qr: string | null };

/** E-mail druhé strany (databáze ho vrací jen účastníkům potvrzené objednávky). */
export async function loadContact(supabase: Supabase, o: OrderRow): Promise<string | null> {
  if (!AGREED.has(o.status) || o.status === 'delivered') return null;
  const { data } = await supabase.rpc('order_counterpart', { target: o.id });
  return (data as Array<{ email: string | null }> | null)?.[0]?.email ?? null;
}

/** Účet prodejce a QR platba pro potvrzenou nebo odeslanou objednávku. */
export async function loadPayment(supabase: Supabase, o: OrderRow): Promise<Payment | null> {
  if (o.status !== 'confirmed' && o.status !== 'shipped') return null;
  const { data } = await supabase.rpc('order_payment', { target: o.id });
  const p = (data as PaymentRow[] | null)?.[0];
  if (!p) return null;
  const qr = p.iban.startsWith('CZ')
    ? await QRCode.toString(spayd({ iban: p.iban, amount: p.amount, vs: p.vs, name: p.account_name }), { type: 'svg', margin: 1, width: 160 })
    : null;
  return { ...p, qr };
}

/** Akce kupujícího podle stavu (stejné na seznamu, v detailu i v chatu). */
export function BuyerActions({ o, reviewed }: { o: OrderRow; reviewed: boolean }) {
  return (
    <>
      {o.status === 'requested' ? <StatusButton id={o.id} status="cancelled" variant="ghost">Zrušit objednávku</StatusButton> : null}
      {o.status === 'confirmed' || o.status === 'shipped' ? <StatusButton id={o.id} status="delivered">Potvrdit převzetí</StatusButton> : null}
      {o.status === 'delivered' && o.seller_id && !reviewed ? (
        <form action={addReview} className={styles.review}>
          <input type="hidden" name="orderId" value={o.id} />
          <input type="hidden" name="sellerId" value={o.seller_id} />
          <label className={styles.field}>
            <span className="t-label muted">HODNOCENÍ</span>
            <select name="rating" defaultValue="5" className={styles.input}>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}{'☆'.repeat(5 - n)} ({n})</option>)}
            </select>
          </label>
          <label className={`${styles.field} ${styles.grow}`}>
            <span className="t-label muted">KOMENTÁŘ (NEPOVINNÝ)</span>
            <input name="comment" maxLength={500} className={styles.input} placeholder="Jak proběhl nákup?" />
          </label>
          <Button type="submit" variant="secondary">Ohodnotit prodejce</Button>
        </form>
      ) : null}
      {reviewed ? <p className="t-small muted">Prodejce jste ohodnotili, děkujeme.</p> : null}
    </>
  );
}

/** Akce prodejce podle stavu. */
export function SellerActions({ o }: { o: OrderRow }) {
  return (
    <>
      {o.status === 'requested' ? (
        <>
          <StatusButton id={o.id} status="confirmed">Potvrdit objednávku</StatusButton>
          <StatusButton id={o.id} status="declined" variant="ghost">Odmítnout</StatusButton>
        </>
      ) : null}
      {o.status === 'confirmed' || o.status === 'paid' ? <StatusButton id={o.id} status="shipped">Označit jako odeslané</StatusButton> : null}
      {o.status === 'confirmed' ? <StatusButton id={o.id} status="cancelled" variant="ghost">Zrušit (kupující nezaplatil)</StatusButton> : null}
    </>
  );
}

export function StatusButton({ id, status, variant, children }: { id: string; status: string; variant?: 'ghost'; children: React.ReactNode }) {
  return (
    <form action={setOrderStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant}>{children}</Button>
    </form>
  );
}

export function OrderCard({ order, counterpart, contact, payment, role, children }: {
  order: OrderRow;
  counterpart: string;
  contact?: string | null;
  payment?: Payment | null;
  role: 'buyer' | 'seller';
  children?: React.ReactNode;
}) {
  const counterpartId = role === 'buyer' ? order.seller_id : order.buyer_id;
  return (
    <article className={styles.order} id={`objednavka-${order.number}`} data-tone={ORDER_TONE[order.status] ?? 'muted'}>
      <div className={styles.head}>
        <div>
          {order.status === 'requested' && order.expires_at ? (
            <ExpiryStatus expiresAt={order.expires_at} role={role} className={styles.status} />
          ) : (
            <Status tone={ORDER_TONE[order.status] ?? 'muted'} className={styles.status}>{STATUS[order.status] ?? order.status}</Status>
          )}
          <p className="t-small muted">
            <Link href={`/objednavky/${order.number}`} className={styles.title}>Objednávka č. <span className="code">{order.number}</span></Link>
            {' · '}{counterpart} · {formatDate(order.created_at)}
            {order.delivery === 'pickup' ? ' · osobní předání' : ''}
          </p>
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
      </ul>
      {order.status === 'requested' && order.expires_at ? (
        <p className="t-small muted">
          {role === 'seller' ? 'Potvrďte nebo odmítněte do' : 'Prodejce potvrdí nejpozději'} {formatDateTime(order.expires_at)}.
          {role === 'seller' ? ' Potom objednávka vyprší a karty se vrátí do nabídky.' : ' Karty jsou zatím rezervované pro vás.'}
        </p>
      ) : null}
      <PaymentInfo payment={payment} role={role} status={order.status} />
      {contact ? (
        <p className="t-small">
          {role === 'buyer' ? 'Kontakt na prodejce: ' : 'Kontakt na kupujícího: '}
          <a href={`mailto:${contact}`}>{contact}</a>
          <span className="muted">
            {role === 'buyer'
              ? ' · Platbu a předání si domluvte přímo s prodejcem. V4cards peníze nepřijímá.'
              : ' · Napište kupujícímu, jak zaplatit a jak kartu předáte.'}
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

/** Účet prodejce a QR platba (DS OrderPayment), nebo věta, co chybí. */
export function PaymentInfo({ payment, role, status }: { payment?: Payment | null; role: 'buyer' | 'seller'; status: string }) {
  return (
    <>
      {payment ? (
        <div className={styles.payment}>
          {payment.qr ? <div className={styles.qr} dangerouslySetInnerHTML={{ __html: payment.qr }} aria-label="QR platba" role="img" /> : null}
          <dl className={styles.payLines}>
            <div><dt className="t-label muted">ÚČET</dt><dd className="code">{czAccountNumber(payment.iban) ?? formatIban(payment.iban)}</dd></div>
            {payment.iban.startsWith('CZ') ? <div><dt className="t-label muted">IBAN</dt><dd className="code">{formatIban(payment.iban)}</dd></div> : null}
            <div><dt className="t-label muted">MAJITEL</dt><dd>{payment.account_name}</dd></div>
            <div><dt className="t-label muted">ČÁSTKA</dt><dd><Price amount={payment.amount} /></dd></div>
            <div><dt className="t-label muted">VARIABILNÍ SYMBOL</dt><dd className="code">{payment.vs}</dd></div>
          </dl>
          <p className="t-small muted">
            {role === 'buyer'
              ? 'Platíte přímo prodejci. Pokud jste se domluvili jinak (dobírka, hotově při předání), řiďte se domluvou.'
              : 'Tyto údaje vidí kupující. Kartu odešlete, až platba dorazí na váš účet.'}
          </p>
        </div>
      ) : role === 'buyer' && status === 'confirmed' ? (
        <p className="t-small muted">Prodejce nemá vyplněný účet. Domluvte se s ním na platbě e-mailem.</p>
      ) : role === 'seller' && status === 'confirmed' ? (
        <p className="t-small muted">
          Kupující neví, kam platit. <Link href="/ucet/nastaveni#doprava-platba">Doplňte číslo účtu</Link> a uvidí ho i s QR platbou.
        </p>
      ) : null}
    </>
  );
}
