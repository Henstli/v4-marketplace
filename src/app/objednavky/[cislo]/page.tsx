import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ExpiryMeter, ExpiryStatus } from '@/components/orders/Expiry';
import { Button, ButtonLink, CardThumb, Price, Status } from '@/components/trezor';
import { replyReview } from '../actions';
import { getCurrentUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { ORDER_STATUS } from '@/lib/order-status';
import { flowSteps, nextStep, orderLabel } from '@/lib/order-flow';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { ReportForm } from '@/components/reports/ReportForm';
import { ReportStrip } from '@/components/reports/ReportStrip';
import { canReport, loadOpenReports } from '@/lib/reports';
import { BuyerActions, canReview, DeliveryBox, DeliveryInfo, ENDED, flowOf, loadContact, loadDeliveries, loadPayment, loadShipCaps, markSellerRestricted, ORDER_SELECT, type OrderRow, PaymentInfo, ReviewForm, SellerActions, ShipChangeNotice } from '../parts';
import styles from '../orders.module.css';

type Props = { params: Promise<{ cislo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cislo } = await params;
  return { title: `Objednávka č. ${cislo}` };
}

// Kód stavu z textu zprávy o změně (trigger order_chat_event v databázi).
const EVENT_STATUS: Array<[RegExp, string]> = [
  [/potvrdil objednávku/, 'confirmed'],
  [/Kupující zaplatil/, 'buyer_paid'],
  [/potvrdil platbu|Zaplacena objednávka/, 'paid'],
  [/odeslal objednávku/, 'shipped'],
  [/převzal objednávku|Předána objednávka/, 'delivered'],
];

export default async function OrderDetailPage({ params }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const { cislo } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/prihlaseni?dalsi=/objednavky/${encodeURIComponent(cislo)}`);
  const number = Number(cislo);
  if (!Number.isInteger(number) || number < 1) notFound();

  const supabase = await createClient();
  // Objednávku vrátí databáze jen kupujícímu a prodejci.
  const { data: order } = await supabase.from('orders').select(ORDER_SELECT).eq('number', number).maybeSingle<OrderRow>();
  if (!order) notFound();
  const role = order.buyer_id === user.id ? 'buyer' : 'seller';
  const otherId = role === 'buyer' ? order.seller_id : order.buyer_id;

  const [{ data: other }, { data: events }, { data: review }, contact, payment, caps, deliveries, reports, , { data: mine }] = await Promise.all([
    otherId ? supabase.from('profiles').select('display_name, kind, country').eq('id', otherId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('messages').select('kind, body, created_at').eq('order_id', order.id).order('created_at', { ascending: false }),
    supabase.from('reviews').select('order_id, rating, comment, reply').eq('order_id', order.id).maybeSingle(),
    loadContact(supabase, order),
    loadPayment(supabase, order),
    loadShipCaps(supabase),
    loadDeliveries(supabase, [order.id]),
    loadOpenReports(supabase, [order.id]),
    role === 'buyer' ? markSellerRestricted(supabase, [order]) : Promise.resolve(),
    supabase.from('reports').select('id').eq('order_id', order.id).eq('reporter_id', user.id).neq('status', 'closed').maybeSingle(),
  ]);
  const report = reports.get(order.id);
  const delivery = deliveries.get(order.id);
  const history = (events ?? []).map((e) => ({ body: e.body as string, at: e.created_at as string }));
  const statusAt = new Map<string, string>();
  for (const h of [...history].reverse()) {
    const hit = EVENT_STATUS.find(([re]) => re.test(h.body));
    if (hit && !statusAt.has(hit[1])) statusAt.set(hit[1], h.at);
  }
  const ended = ENDED.has(order.status);
  const flow = flowOf(order);
  const steps = flowSteps(flow);
  const label = orderLabel(flow, role);
  const next = nextStep(flow, role);
  const otherName = other?.display_name ?? 'smazaný účet';
  const tab = role === 'buyer' ? 'nakupy' : 'prodeje';
  const count = order.order_items.reduce((n, i) => n + i.quantity, 0);
  // Čeká na prodejce: odpočet do vypršení (DS Status, varianta B).
  const waiting = order.status === 'requested' && !!order.expires_at;

  return (
    <div className={`container ${styles.page} ${styles.detail}`}>
      <Link href={`/objednavky?tab=${tab}`} className={`t-small ${styles.crumb}`}>← Objednávky › {role === 'buyer' ? 'Nákupy' : 'Prodeje'}</Link>
      <header className={styles.detailHead}>
        <div>
          <div className={styles.detailTitle}>
            <h1 className="t-heading-l">Objednávka č. <span className="code">{order.number}</span></h1>
            {waiting ? (
              <ExpiryStatus expiresAt={order.expires_at!} role={role} />
            ) : (
              <Status tone={label.tone}>{label.text}</Status>
            )}
          </div>
          <p className="t-small muted">
            Objednáno {formatDateTime(order.created_at)} · {role === 'buyer' ? 'prodejce' : 'kupující'} {otherName}
          </p>
          <DeliveryInfo o={order} />
        </div>
        <Price amount={order.total_czk} size="lg" />
      </header>
      {report ? <ReportStrip number={report.number} /> : null}

      <div className={styles.detailGrid}>
        <div className={styles.detailCol}>
          <section className={styles.box} aria-labelledby="postup">
            <h2 id="postup" className={styles.boxTitle}>Postup</h2>
            {ended ? (
              <p className="t-small muted">{history.find((h) => /zrušil|odmítl|vypršela/.test(h.body))?.body ?? ORDER_STATUS[order.status]}.</p>
            ) : (
              <ol className={styles.steps}>
                {steps.map((s, n) => {
                  const at = s.key === 'ordered' ? order.created_at : s.key === 'buyer_paid' ? order.buyer_paid_at ?? statusAt.get('buyer_paid') : statusAt.get(s.key);
                  // Krok, na který se čeká do vypršení, má termín.
                  const due = waiting && n === 1;
                  return (
                    <li key={s.key} data-done={s.done ? '' : undefined} data-due={due ? '' : undefined}>
                      <strong>{s.label}</strong>
                      <span className="t-small muted">
                        {s.done ? (at ? formatDateTime(at) : 'hotovo') : due ? `${role === 'seller' ? 'potvrďte do' : 'prodejce potvrdí do'} ${formatDateTime(order.expires_at!)}` : s.waiting}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className={styles.box} aria-labelledby="karty">
            <h2 id="karty" className={styles.boxTitle}>Karty</h2>
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
            </ul>
            <div className={styles.sum}>
              <span className="muted">{order.delivery === 'pickup' ? 'Osobní předání' : 'Doprava'}</span>
              <Price amount={order.shipping_czk} />
            </div>
            {order.cod_fee_czk ? (
              <div className={styles.sum}>
                <span className="muted">Příplatek za dobírku</span>
                <Price amount={order.cod_fee_czk} />
              </div>
            ) : null}
            <div className={`${styles.sum} ${styles.sumTotal}`}>
              <span>Celkem · {count}&nbsp;ks</span>
              <Price amount={order.total_czk} />
            </div>
          </section>

          {order.status === 'confirmed' && (order.payment ?? 'transfer') === 'transfer' && order.ship_change_czk == null && !(role === 'buyer' && order.buyer_paid_at) ? (
            <section className={styles.box} aria-labelledby="platba">
              <h2 id="platba" className={styles.boxTitle}>Platba</h2>
              <PaymentInfo payment={payment} role={role} order={order} />
            </section>
          ) : null}

          {delivery || (role === 'seller' && order.status === 'requested' && (order.ship_city || order.pickup_point)) ? (
            <section className={styles.box} aria-label={role === 'seller' ? 'Kam poslat' : 'Doručení'}>
              <DeliveryBox d={delivery} o={order} role={role} />
            </section>
          ) : null}
        </div>

        <aside className={styles.detailCol}>
          <section className={styles.box} aria-labelledby="strana">
            <h2 id="strana" className={styles.boxTitle}>{role === 'buyer' ? 'Prodejce' : 'Kupující'}</h2>
            {otherId && role === 'buyer' ? <Link href={`/prodejci/${otherId}`} className={styles.party}>{otherName}</Link> : <strong>{otherName}</strong>}
            {contact ? <p className="t-small">E-mail: <a href={`mailto:${contact}`}>{contact}</a></p> : null}
            {otherId ? (
              <ButtonLink href={`/zpravy/${otherId}`} variant="secondary" className={styles.wideBtn}>
                {role === 'buyer' ? 'Napsat prodejci' : 'Napsat kupujícímu'}
              </ButtonLink>
            ) : null}
            {otherId && !mine && canReport({ created_at: order.created_at, delivered_at: order.delivered_at, status: order.status }) ? (
              <ReportForm orderId={order.id} number={order.number} role={role} uid={user.id} delivered={['shipped', 'delivered', 'paid'].includes(order.status)} />
            ) : null}
            <Link href={`/podpora?objednavka=${order.number}`} className="t-small">Napsat podpoře</Link>
          </section>

          {!ended ? (
            <section className={styles.box} aria-labelledby="dal">
              <h2 id="dal" className={styles.boxTitle}>Co dál</h2>
              {next ? <p className="t-small muted">{next}</p> : null}
              {waiting ? <ExpiryMeter createdAt={order.created_at} expiresAt={order.expires_at!} /> : null}
              <ShipChangeNotice o={order} role={role} />
              <div className={`${styles.actions} ${styles.sideActions}`}>
                {role === 'buyer' ? <BuyerActions o={order} reviewed={!!review} /> : <SellerActions o={order} shipCap={order.carrier ? caps.get(order.carrier) : null} />}
              </div>
            </section>
          ) : null}

          {review ? (
            <section className={styles.box} aria-labelledby="hodnoceni-kupujiciho">
              <h2 id="hodnoceni-kupujiciho" className={styles.boxTitle}>{role === 'seller' ? 'Hodnocení od kupujícího' : 'Vaše hodnocení'}</h2>
              <p><span aria-label={`${review.rating} z 5`}>{'★'.repeat(review.rating as number)}{'☆'.repeat(5 - (review.rating as number))}</span>{review.comment ? ` · ${review.comment}` : ''}</p>
              {review.reply ? <p className="t-small"><strong>Odpověď prodejce:</strong> {review.reply as string}</p> : role === 'seller' ? (
                <form action={replyReview} className={styles.review}>
                  <input type="hidden" name="orderId" value={order.id} />
                  <label className={`${styles.field} ${styles.grow}`}>
                    <span className="t-label muted">ODPOVĚĎ (JEN JEDNOU, VEŘEJNĚ U HODNOCENÍ)</span>
                    <input name="reply" maxLength={500} required className={styles.input} />
                  </label>
                  <Button type="submit" variant="secondary">Odpovědět</Button>
                </form>
              ) : null}
            </section>
          ) : role === 'buyer' && ended && canReview(order) ? (
            <section className={styles.box} aria-labelledby="hodnoceni">
              <h2 id="hodnoceni" className={styles.boxTitle}>Hodnocení prodejce</h2>
              <ReviewForm o={order} />
            </section>
          ) : null}

          {history.length ? (
            <section className={styles.box} aria-labelledby="historie">
              <h2 id="historie" className={styles.boxTitle}>Historie</h2>
              <ul className={styles.history}>
                {history.map((h, n) => (
                  <li key={n}><span>{h.body}</span><span className="muted">{formatDateTime(h.at)}</span></li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
