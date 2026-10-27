import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ButtonLink, CardThumb, Price, Status } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { ORDER_STATUS, ORDER_TONE } from '@/lib/order-status';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { BuyerActions, ENDED, loadContact, loadPayment, ORDER_SELECT, type OrderRow, PaymentInfo, SellerActions } from '../parts';
import styles from '../orders.module.css';

type Props = { params: Promise<{ cislo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cislo } = await params;
  return { title: `Objednávka č. ${cislo}` };
}

// Postup jako v chatu (DS Messages): který krok je hotový v jakém stavu a ze které změny stavu bereme čas.
const STEPS: Array<{ label: string; at: string[]; waiting: string }> = [
  { label: 'Odesláno', at: [], waiting: '' },
  { label: 'Potvrzeno', at: ['confirmed'], waiting: 'čeká na prodejce' },
  { label: 'Zaplaceno a odesláno', at: ['paid', 'shipped'], waiting: 'čeká na platbu' },
  { label: 'Převzato', at: ['delivered'], waiting: 'čeká na doručení' },
];
const STEP_DONE: Record<string, number> = { requested: 1, confirmed: 2, pending_payment: 2, paid: 3, shipped: 3, delivered: 4 };

// Co dál podle stavu a role.
const NEXT: Record<string, { buyer: string; seller: string }> = {
  requested: { buyer: 'Prodejce objednávku potvrdí nebo odmítne. Karty jsou zatím rezervované pro vás.', seller: 'Potvrďte, že karty máte a prodáte je, nebo objednávku odmítněte.' },
  confirmed: { buyer: 'Zaplaťte prodejci převodem nebo QR kódem. Kartu odešle, až platba dorazí.', seller: 'Počkejte na platbu a kartu odešlete. Pak ji označte jako odeslanou.' },
  pending_payment: { buyer: 'Zaplaťte prodejci podle údajů níže.', seller: 'Počkejte na platbu od kupujícího.' },
  paid: { buyer: 'Prodejce kartu odešle.', seller: 'Platba dorazila, kartu odešlete a označte jako odeslanou.' },
  shipped: { buyer: 'Karta je na cestě. Až dorazí, potvrďte převzetí.', seller: 'Kupující potvrdí převzetí, až karta dorazí.' },
  delivered: { buyer: 'Hotovo. Ohodnoťte prosím prodejce.', seller: 'Hotovo, karta je předaná.' },
};

// Kód stavu z textu zprávy o změně (trigger order_chat_event v databázi).
const EVENT_STATUS: Array<[RegExp, string]> = [
  [/potvrdil objednávku/, 'confirmed'],
  [/Zaplacena objednávka/, 'paid'],
  [/odeslal objednávku/, 'shipped'],
  [/převzal objednávku/, 'delivered'],
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

  const [{ data: other }, { data: events }, { data: review }, contact, payment] = await Promise.all([
    otherId ? supabase.from('profiles').select('display_name, kind, country').eq('id', otherId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('messages').select('kind, body, created_at').eq('order_id', order.id).order('created_at', { ascending: false }),
    supabase.from('reviews').select('order_id').eq('order_id', order.id).maybeSingle(),
    loadContact(supabase, order),
    loadPayment(supabase, order),
  ]);
  const history = (events ?? []).map((e) => ({ body: e.body as string, at: e.created_at as string }));
  const statusAt = new Map<string, string>();
  for (const h of [...history].reverse()) {
    const hit = EVENT_STATUS.find(([re]) => re.test(h.body));
    if (hit && !statusAt.has(hit[1])) statusAt.set(hit[1], h.at);
  }
  const ended = ENDED.has(order.status);
  const done = STEP_DONE[order.status] ?? 0;
  const otherName = other?.display_name ?? 'smazaný účet';
  const tab = role === 'buyer' ? 'nakupy' : 'prodeje';
  const count = order.order_items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className={`container ${styles.page} ${styles.detail}`}>
      <Link href={`/objednavky?tab=${tab}`} className={`t-small ${styles.crumb}`}>← Objednávky › {role === 'buyer' ? 'Nákupy' : 'Prodeje'}</Link>
      <header className={styles.detailHead}>
        <div>
          <div className={styles.detailTitle}>
            <h1 className="t-heading-l">Objednávka č. <span className="code">{order.number}</span></h1>
            <Status tone={ORDER_TONE[order.status] ?? 'muted'}>{ORDER_STATUS[order.status] ?? order.status}</Status>
          </div>
          <p className="t-small muted">
            Objednáno {formatDateTime(order.created_at)} · {role === 'buyer' ? 'prodejce' : 'kupující'} {otherName}
            {order.delivery === 'pickup' ? ' · osobní předání' : ''}
          </p>
        </div>
        <Price amount={order.total_czk} size="lg" />
      </header>

      <div className={styles.detailGrid}>
        <div className={styles.detailCol}>
          <section className={styles.box} aria-labelledby="postup">
            <h2 id="postup" className={styles.boxTitle}>Postup</h2>
            {ended ? (
              <p className="t-small muted">{history.find((h) => /zrušil|odmítl|vypršela/.test(h.body))?.body ?? ORDER_STATUS[order.status]}.</p>
            ) : (
              <ol className={styles.steps}>
                {STEPS.map((s, n) => {
                  const on = n < done;
                  const at = n === 0 ? order.created_at : s.at.map((k) => statusAt.get(k)).find(Boolean);
                  return (
                    <li key={s.label} data-done={on ? '' : undefined}>
                      <strong>{s.label}</strong>
                      <span className="t-small muted">{on ? (at ? formatDateTime(at) : 'hotovo') : s.waiting}</span>
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
            <div className={`${styles.sum} ${styles.sumTotal}`}>
              <span>Celkem · {count}&nbsp;ks</span>
              <Price amount={order.total_czk} />
            </div>
          </section>

          {payment || order.status === 'confirmed' ? (
            <section className={styles.box} aria-labelledby="platba">
              <h2 id="platba" className={styles.boxTitle}>Platba</h2>
              <PaymentInfo payment={payment} role={role} status={order.status} />
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
          </section>

          {!ended ? (
            <section className={styles.box} aria-labelledby="dal">
              <h2 id="dal" className={styles.boxTitle}>Co dál</h2>
              {NEXT[order.status] ? <p className="t-small muted">{NEXT[order.status][role]}</p> : null}
              {order.status === 'requested' && order.expires_at ? (
                <p className="t-small muted">{role === 'seller' ? 'Potvrďte do' : 'Prodejce potvrdí nejpozději'} {formatDateTime(order.expires_at)}.</p>
              ) : null}
              <div className={`${styles.actions} ${styles.sideActions}`}>
                {role === 'buyer' ? <BuyerActions o={order} reviewed={!!review} /> : <SellerActions o={order} />}
              </div>
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
