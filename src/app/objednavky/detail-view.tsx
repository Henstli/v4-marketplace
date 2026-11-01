import Link from 'next/link';
import QRCode from 'qrcode';
import { Ava } from '@/components/orders/Ava';
import { CopyButton } from '@/components/orders/CopyButton';
import { ExpiryStatus, NowMeter } from '@/components/orders/Expiry';
import { DeclineSwap, ModeArea, ModeButton, NowModes } from '@/components/orders/NowMode';
import { OrderItems, type ItemRow } from '@/components/orders/OrderItems';
import { PayNow, type PayMethod } from '@/components/orders/PayNow';
import { SellerRestrictedNotice } from '@/components/orders/SellerRestricted';
import { StarsReview } from '@/components/orders/StarsReview';
import { ReportDialog } from '@/components/reports/ReportForm';
import { ReportStrip } from '@/components/reports/ReportStrip';
import { Button, ButtonLink, Status } from '@/components/trezor';
import { CARRIER_NAME, methodName, PAYMENT_NAME } from '@/lib/delivery';
import { formatDateTime, formatNumber } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { canChangeShipping, flowActions, flowSteps, nextStep, orderLabel, PAID_VIA, trackingUrl, type FlowAction } from '@/lib/order-flow';
import { orderTask, unpaidDays } from '@/lib/order-tasks';
import { czAccountNumber, formatIban, spayd } from '@/lib/payment';
import type { PrepayRow } from '@/lib/prepay';
import { canReport } from '@/lib/reports';
import { replyReview, setOrderStatus } from './actions';
import { CancelBlocks, canReview, type DeliveryRow, ENDED, FlowButton, flowOf, type OrderRow, PaidViaInfo, ShipChangeNotice } from './parts';
import { ShipEdit } from './ShipEdit';
import styles from './orders.module.css';

// Kód stavu z textu zprávy o změně (trigger order_chat_event v databázi).
const EVENT_STATUS: Array<[RegExp, string]> = [
  [/potvrdil objednávku|potvrzena objednávka/, 'confirmed'],
  [/Kupující zaplatil/, 'buyer_paid'],
  [/potvrdil platbu|Zaplacena objednávka/, 'paid'],
  [/odeslal objednávku/, 'shipped'],
  [/převzal objednávku|Předána objednávka/, 'delivered'],
  [/odmítl objednávku|zrušil objednávku|Zrušena objednávka|Vypršela/, 'ended'],
];
const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const XI = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const ENDED_LABEL: Record<string, string> = { declined: 'Odmítnuto', cancelled: 'Zrušeno', expired: 'Vypršelo' };
const kc = (n: number) => `${formatNumber(n)} Kč`;
const VARIANT_ORDER = { ghost: 0, secondary: 1, primary: 2 } as const;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', margin: 1, width: 150 });
}


export interface DetailData {
  order: OrderRow;
  role: 'buyer' | 'seller';
  uid: string;
  other: { display_name: string | null; kind: string | null } | null;
  events: Array<{ kind: string; body: string; created_at: string }>;
  review: { rating: number; comment: string | null; reply: string | null } | null;
  prepay: PrepayRow | null;
  caps: Map<string, number>;
  delivery?: DeliveryRow | null;
  report?: { number: number } | null;
  mine: boolean;
  ratings: number[];
}

/** Detail objednávky (DS Orders › Detail); data načte stránka, tady jen vzhled a pravidla. */
export async function OrderDetailView({ order, role, uid, other, events, review, prepay, caps, delivery, report, mine, ratings }: DetailData) {
  const otherId = role === 'buyer' ? order.seller_id : order.buyer_id;
  const sellerId = order.seller_id;
  const payTransfer = (order.payment ?? 'transfer') === 'transfer';
  const needPay = role === 'buyer' && order.status === 'confirmed' && payTransfer && !order.buyer_paid_at && order.ship_change_czk == null;
  const history = events.map((e) => ({ body: e.body as string, at: e.created_at as string }));
  const statusAt = new Map<string, string>();
  for (const h of [...history].reverse()) {
    const hit = EVENT_STATUS.find(([re]) => re.test(h.body));
    if (hit && !statusAt.has(hit[1])) statusAt.set(hit[1], h.at);
  }
  const ended = ENDED.has(order.status);
  const flow = flowOf(order);
  const task = orderTask({ ...flow, decidedAt: order.decided_at, createdAt: order.created_at }, role);
  const myTurn = task.bucket === 'ja';
  const label = orderLabel(flow, role);
  const otherName = other?.display_name ?? 'smazaný účet';
  const tab = role === 'buyer' ? 'nakupy' : 'prodeje';
  const count = order.order_items.reduce((n, i) => n + i.quantity, 0);
  const waiting = order.status === 'requested' && !!order.expires_at && order.ship_change_czk == null;
  const carrier = order.carrier ? methodName({ carrier: order.carrier, label: order.carrier_label }) : null;
  const how = order.delivery === 'pickup' ? 'osobní předání' : carrier ?? 'doprava';
  const payName = order.payment && order.payment !== 'transfer' ? PAYMENT_NAME[order.payment] : 'platba předem';
  const problem = (order.status === 'confirmed' && ((!!order.not_received_at && !order.buyer_insist_at) || !!order.cancel_request_at)) || order.ship_change_czk != null;
  const trackUrl = trackingUrl(order.carrier, order.tracking);
  const carrierShort = order.carrier ? (CARRIER_NAME as Record<string, string>)[order.carrier]?.split(' ')[0] ?? carrier : null;

  // Kroky nahoře (DS Orders › Postup), u ukončené objednávky křížek na kroku, kde skončila.
  const raw = flowSteps(flow);
  const doneAt = (key: string) => key === 'ordered' ? order.created_at : key === 'buyer_paid' ? order.buyer_paid_at ?? statusAt.get('buyer_paid') : key === 'delivered' ? order.delivered_at ?? statusAt.get('delivered') : statusAt.get(key);
  const steps = raw.map((s) => ({ ...s, done: ended ? s.key === 'ordered' || !!doneAt(s.key) : s.done }));
  const cur = steps.findIndex((s) => !s.done);
  const stepView = steps.map((s, i) => {
    if (s.done) return { key: s.key, state: 'done', label: s.label, sub: doneAt(s.key) ? formatDateTime(doneAt(s.key)!) : '' };
    if (i === cur && ended) return { key: s.key, state: 'x', label: ENDED_LABEL[order.status] ?? 'Ukončeno', sub: order.decided_at || statusAt.get('ended') ? formatDateTime((statusAt.get('ended') ?? order.decided_at)!) : '' };
    if (i === cur) {
      const sub = order.status === 'requested' && order.expires_at
        ? (role === 'seller' ? 'čeká na vás' : `do ${formatDateTime(order.expires_at)}`)
        : order.not_received_at && !order.buyer_insist_at && s.key === 'paid' ? 'prodejce ji nenašel'
          : order.payment === 'cod' && s.key === 'delivered' && role === 'buyer' ? 'zaplatíte při převzetí' : myTurn ? 'čeká na vás' : s.waiting;
      return { key: s.key, state: problem ? 'warn' : 'cur', label: s.label, sub };
    }
    return { key: s.key, state: 'todo', label: s.label, sub: '' };
  });
  const curView = stepView[cur >= 0 ? cur : stepView.length - 1];

  // Rámeček Co teď: nadpis, věta a tlačítka podle stavu a role.
  const days = unpaidDays({ decidedAt: order.decided_at, createdAt: order.created_at });
  const via = order.paid_via ? PAID_VIA[order.paid_via] : null;
  const title = (() => {
    const s = order.status;
    if (s === 'declined') return role === 'buyer' ? 'Prodejce objednávku odmítl' : 'Objednávku jste odmítli';
    if (s === 'expired') return 'Objednávka vypršela';
    if (s === 'cancelled') return history.find((h) => /zrušil|Zrušena/.test(h.body))?.body.replace(/ č\. \d+.*$/, '') ?? 'Objednávka je zrušená';
    if (role === 'seller') {
      if (s === 'requested') return order.ship_change_czk != null ? 'Čeká se na souhlas s dopravou' : `Nová objednávka, potvrďte do ${formatDateTime(order.expires_at!)}`;
      if (s === 'confirmed') {
        if (order.ship_change_czk != null) return 'Čeká se na souhlas s dopravou';
        if (payTransfer) {
          if (!order.buyer_paid_at) return task.task === 'nezaplaceno' ? `Kupující nezaplatil už ${days} ${days < 5 ? 'dny' : 'dní'}` : 'Čeká se na platbu';
          if (order.cancel_request_at) return 'Čeká se na odpověď kupujícího';
          if (order.not_received_at && !order.buyer_insist_at) return 'Kupující ověřuje platbu';
          if (order.buyer_insist_at) return 'Zkontrolujte platbu znovu';
          return `Zkontrolujte platbu ${kc(order.total_czk)}${via ? ` (${via.name})` : ''}`;
        }
        return order.payment === 'cod' ? 'Zabalte a odešlete na dobírku' : 'Předejte karty a vezměte platbu';
      }
      if (s === 'paid') return order.delivery === 'pickup' ? 'Domluvte předání' : `Zabalte a odešlete${carrierShort ? ` (${carrierShort})` : ''}`;
      if (s === 'shipped') return 'Zásilka je na cestě';
      return 'Hotovo, karty jsou předané';
    }
    if (s === 'requested') return order.ship_change_czk != null ? 'Prodejce navrhl vyšší dopravu' : 'Prodejce objednávku potvrdí';
    if (s === 'confirmed') {
      if (order.ship_change_czk != null) return 'Prodejce navrhl vyšší dopravu';
      if (payTransfer) {
        if (order.cancel_request_at) return 'Prodejce žádá o zrušení';
        if (order.not_received_at && !order.buyer_insist_at) return `Prodejce platbu na ${via?.where === 'PayPal' ? 'PayPalu' : via?.where === 'Revolut' ? 'Revolutu' : 'účtu'} nenašel`;
        return order.buyer_insist_at ? 'Prodejce kontroluje platbu znovu' : 'Prodejce kontroluje platbu';
      }
      return order.payment === 'cod' ? 'Prodejce odešle na dobírku' : 'Domluvte předání';
    }
    if (s === 'paid') return order.delivery === 'pickup' ? 'Domluvte předání' : 'Prodejce balí a odešle';
    if (s === 'shipped') return order.payment === 'cod' ? `Při převzetí zaplatíte ${kc(order.total_czk)}` : 'Zásilka je na cestě';
    return review ? 'Hotovo, děkujeme' : 'Hotovo, ohodnoťte prodejce';
  })();
  const text = (() => {
    const s = order.status;
    if (s === 'declined') return order.decline_reason ? `„${order.decline_reason}“ Nic neplatíte, karty se vrátily do nabídky.` : 'Nic neplatíte, karty se vrátily do nabídky.';
    if (s === 'expired') return 'Prodejce objednávku nepotvrdil včas. Nic neplatíte, karty se vrátily do nabídky.';
    if (s === 'cancelled') return 'Karty se vrátily do nabídky.';
    if (role === 'seller' && s === 'paid' && order.delivery === 'ship') return `Platba přišla${statusAt.get('paid') ? ` ${formatDateTime(statusAt.get('paid')!)}` : ''}. Podejte zásilku${carrierShort ? ` u dopravce ${carrierShort}` : ''} na místo vpravo a zadejte číslo zásilky, kupující ho uvidí jako odkaz na sledování.`;
    if (role === 'buyer' && s === 'confirmed' && payTransfer && order.buyer_paid_at && !order.not_received_at && !order.cancel_request_at) {
      const bank = order.paid_via === 'bank' || !via;
      return `Zaplatili jste ${bank ? 'QR převodem' : `přes ${via!.name}`} ${formatDateTime(order.buyer_paid_at)}. ${bank ? 'Převod z banky může trvat až 2 pracovní dny, pak prodejce kartu odešle.' : 'Prodejce platbu zkontroluje a kartu odešle.'}`;
    }
    if (role === 'seller' && task.task === 'nezaplaceno') return 'Připomeňte se ve zprávách. Dokud kupující neklikne na Zaplaceno, můžete objednávku zrušit.';
    return nextStep(flow, role) ?? '';
  })();
  const tone = ended ? 'end' : order.seller_restricted ? 'bad' : problem || task.task === 'nezaplaceno' ? 'warn' : myTurn ? undefined : 'end';

  // Tlačítka: vedlejší vlevo, hlavní vpravo (DS Orders).
  const actions = flowActions(flow, role).filter((a) => a.op !== 'mark_paid').sort((a, b) => VARIANT_ORDER[a.variant] - VARIANT_ORDER[b.variant]);
  const sellerRequested = role === 'seller' && order.status === 'requested' && order.ship_change_czk == null;
  const shipEditable = role === 'seller' && canChangeShipping(flow) && order.ship_change_czk == null;
  const button = (a: FlowAction) => {
    if (a.op === 'status' && a.tracking) {
      return (
        <form key={a.label} action={setOrderStatus} className="tz-ord-track">
          <input type="hidden" name="id" value={order.id} />
          <input type="hidden" name="op" value="status" />
          <input type="hidden" name="status" value="shipped" />
          <input name="tracking" maxLength={60} className="code" placeholder="Číslo zásilky (nepovinné)" aria-label="Číslo zásilky" />
          <Button type="submit">{a.label}</Button>
        </form>
      );
    }
    if (sellerRequested && a.op === 'status' && a.status === 'declined') return <ModeButton key={a.label} to="decline" variant="secondary">Odmítnout</ModeButton>;
    return <FlowButton key={a.label} id={order.id} action={a.op === 'status' && a.status === 'confirmed' ? { ...a, label: 'Potvrdit' } : a} />;
  };
  const tracking = order.tracking && (order.status === 'shipped' || order.status === 'delivered') ? (
    <p className="tz-ord-trackline">
      {carrierShort ? `${carrierShort} · ` : ''}číslo zásilky {trackUrl ? <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="tz-ord-num">{order.tracking}</a> : <span className="tz-ord-num">{order.tracking}</span>} <CopyButton text={order.tracking} className="tz-ord-copy" />
    </p>
  ) : null;
  const shipEdit = shipEditable ? (
    <ModeArea when="ship">
      <ShipEdit
        inNow
        id={order.id}
        carrier={carrier ?? 'Doprava'}
        shipping={order.shipping_czk}
        total={order.total_czk}
        cap={order.carrier ? caps.get(order.carrier) ?? null : null}
      />
    </ModeArea>
  ) : null;
  const more = (
    <>
      {shipEdit}
      <ShipChangeNotice o={order} role={role} />
      <CancelBlocks o={order} role={role} />
      {order.seller_restricted ? <SellerRestrictedNotice /> : null}
      {role === 'seller' && order.status === 'confirmed' ? <PaidViaInfo o={order} role="seller" /> : null}
      {role === 'buyer' && !review && canReview(order) ? <StarsReview orderId={order.id} sellerId={order.seller_id!} cancelled={order.status === 'cancelled'} /> : null}
      {review ? (
        <div className="tz-ord-reviewed">
          <p><span className="tz-ord-stars-static" aria-label={`${review.rating} z 5`}>{'★'.repeat(review.rating as number)}<span>{'★'.repeat(5 - (review.rating as number))}</span></span>{review.comment ? ` ${review.comment}` : ''}</p>
          {review.reply ? <p className="t-small"><strong>Odpověď prodejce:</strong> {review.reply as string}</p> : role === 'seller' ? (
            <form action={replyReview} className="tz-ord-review">
              <input type="hidden" name="orderId" value={order.id} />
              <input name="reply" maxLength={500} required placeholder="Odpovědět na hodnocení (jen jednou, veřejně)" aria-label="Odpověď na hodnocení" />
              <Button type="submit" variant="secondary">Odpovědět</Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </>
  );

  // Platba předem: QR u všech způsobů (převod SPAYD, PayPal a Revolut odkaz), Zaplaceno přes vybranou záložku.
  let methods: PayMethod[] = [];
  if (needPay && prepay) {
    const note = `V4cards č. ${order.number}`;
    const paypal = prepay.paypal_me ? `https://paypal.me/${encodeURIComponent(prepay.paypal_me)}/${prepay.amount}CZK` : null;
    const revolut = prepay.revtag ? `https://revolut.me/${encodeURIComponent(prepay.revtag)}?currency=CZK&amount=${prepay.amount * 100}&note=${encodeURIComponent(note)}` : null;
    const [bankQr, paypalQr, revolutQr] = await Promise.all([
      prepay.iban?.startsWith('CZ') && prepay.account_name ? qrSvg(spayd({ iban: prepay.iban, amount: prepay.amount, vs: prepay.vs, name: prepay.account_name })) : null,
      paypal ? qrSvg(paypal) : null,
      revolut ? qrSvg(revolut) : null,
    ]);
    if (prepay.iban) {
      methods.push({
        key: 'bank', label: 'QR převod', qr: bankQr,
        rows: [
          { k: 'Částka', v: kc(prepay.amount), code: true, copy: true },
          { k: 'Účet', v: czAccountNumber(prepay.iban) ?? formatIban(prepay.iban), code: true, copy: true },
          ...(prepay.iban.startsWith('CZ') ? [] : [{ k: 'IBAN', v: formatIban(prepay.iban), code: true, copy: true }]),
          { k: 'Var. symbol', v: String(prepay.vs), code: true, copy: true },
          ...(prepay.account_name ? [{ k: 'Majitel', v: prepay.account_name }] : []),
        ],
        note: bankQr ? 'QR naskenujte v aplikaci banky, vyplní částku i variabilní symbol.' : 'Platíte přímo prodejci, V4cards peníze nepřijímá.',
      });
    }
    if (paypal) {
      methods.push({
        key: 'paypal', label: 'PayPal', qr: paypalQr,
        rows: [{ k: 'Částka', v: kc(prepay.amount), code: true, copy: true }, { k: 'PayPal', v: `paypal.me/${prepay.paypal_me}`, code: true, copy: true }],
        link: { href: paypal, label: 'Otevřít PayPal', hint: 'QR vlevo otevře PayPal s částkou v telefonu.' },
        note: 'Zvolte platbu za zboží, jinak nemáte ochranu kupujícího PayPal.',
      });
    }
    if (revolut) {
      methods.push({
        key: 'revolut', label: 'Revolut', qr: revolutQr,
        rows: [{ k: 'Částka', v: kc(prepay.amount), code: true, copy: true }, { k: 'Revtag', v: `@${prepay.revtag}`, code: true, copy: true }, { k: 'Poznámka', v: note, copy: true }],
        link: { href: revolut, label: 'Otevřít Revolut', hint: 'QR vlevo otevře Revolut s částkou a poznámkou v telefonu.' },
        note: 'Když aplikace Revolut částku nebo poznámku nevyplní, vložte je ručně.',
      });
    }
  } else methods = [];

  const items: ItemRow[] = order.order_items.map((i) => ({
    name: i.cards?.name ?? 'Karta',
    slug: i.cards?.slug ?? null,
    set: [one(i.cards?.card_sets)?.code?.toUpperCase(), i.cards?.number].filter(Boolean).join(' '),
    cond: i.condition,
    qty: i.quantity,
    price: i.price_czk * i.quantity,
    img: thumbUrl(i.cards?.image_url ?? undefined),
    color: i.cards?.game_id ? `var(--game-${i.cards.game_id}-art)` : undefined,
    game: i.cards?.game_id ?? null,
  }));
  const sums = [
    { label: order.delivery === 'pickup' ? 'Osobní předání' : `Doprava${carrierShort ? ` ${carrierShort}` : ''}`, amount: order.shipping_czk },
    ...(order.cod_fee_czk ? [{ label: 'Příplatek za dobírku', amount: order.cod_fee_czk }] : []),
    { label: 'Celkem', amount: order.total_czk, total: true },
  ];
  const packing = role === 'seller' && ['confirmed', 'paid'].includes(order.status);

  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const kindName = other?.kind === 'shop' ? 'Obchod' : 'Sběratel';
  const partyLine = [kindName, role === 'buyer' && avg != null ? `★ ${avg.toFixed(1).replace('.', ',')} (${ratings.length})` : null].filter(Boolean).join(' · ');

  const nowBox = needPay ? (
    <PayNow
      id={order.id}
      title={`Zaplaťte ${kc(order.total_czk)}`}
      text="Prodejce objednávku potvrdil. Vyberte, jak zaplatíte, zaplaťte a klikněte na Zaplaceno."
      methods={methods}
      cancel={<FlowButton id={order.id} action={{ op: 'status', status: 'cancelled', label: 'Zrušit objednávku', variant: 'ghost' }} />}
      more={more}
    />
  ) : (
    <NowModes>
      <section className="tz-ord-now" data-tone={tone} aria-labelledby="co-ted">
        <div className="tz-ord-now-top">
          <div className="tz-ord-now-tx">
            <p className="tz-ord-now-lbl">{ended ? 'Ukončeno' : 'Co teď'}</p>
            <h2 id="co-ted">{title}</h2>
            {tracking}
            {text ? <p>{text}</p> : null}
            {waiting ? <NowMeter createdAt={order.created_at} expiresAt={order.expires_at!} /> : null}
          </div>
          {actions.length || trackUrl || ended ? (
            <div className="tz-ord-now-acts">
              <ModeArea when="">
                {shipEditable ? <ModeButton to="ship" variant="ghost">Upravit dopravu</ModeButton> : null}
                {trackUrl && order.status === 'shipped' ? <a className="tz-btn tz-btn-secondary tz-btn-md" href={trackUrl} target="_blank" rel="noopener noreferrer">Sledovat na webu {carrierShort} ↗</a> : null}
                {ended && role === 'buyer' ? <ButtonLink href="/karty" variant="secondary">Hledat karty jinde</ButtonLink> : null}
                {actions.map(button)}
              </ModeArea>
              {sellerRequested ? <DeclineSwap id={order.id} /> : null}
            </div>
          ) : null}
        </div>
        <div className="tz-ord-now-more">{more}</div>
      </section>
    </NowModes>
  );

  // Pravý sloupec: u prodejce nejdřív Kam poslat (Šimon 1. 11.), u kupujícího nejdřív prodejce.
  const party = (
    <section className="tz-ord-box" aria-labelledby="strana">
      <div className="tz-ord-box-h"><h2 id="strana">{role === 'buyer' ? 'Prodejce' : 'Kupující'}</h2></div>
      <div className="tz-ord-party">
        <Ava id={otherId} name={otherName} size="l" />
        <div>
          <b>{otherId && role === 'buyer' ? <Link href={`/prodejci/${otherId}`}>{otherName}</Link> : otherName}</b>
          <span>{partyLine}</span>
        </div>
      </div>
      {otherId ? <ButtonLink href={`/zpravy/${otherId}`} variant="secondary" className="tz-ord-wide">{role === 'buyer' ? 'Napsat prodejci' : 'Napsat kupujícímu'}</ButtonLink> : null}
      <div className="tz-ord-links">
        {otherId && !mine && canReport({ created_at: order.created_at, delivered_at: order.delivered_at, status: order.status }) ? (
          <ReportDialog orderId={order.id} number={order.number} role={role} uid={uid} delivered={['shipped', 'delivered', 'paid'].includes(order.status)} />
        ) : null}
        <Link href={`/podpora?objednavka=${order.number}`}>Napsat podpoře</Link>
      </div>
    </section>
  );
  const place = <DeliveryCard d={delivery} o={order} role={role} />;

  return (
    <div className={`container ${styles.list}`}>
      <Link href={`/objednavky?tab=${tab}`} className="tz-ord-crumb">← Objednávky › {role === 'buyer' ? 'Nákupy' : 'Prodeje'}</Link>
      <header className="tz-ord-head">
        <div>
          <h1 className="t-heading-l">
            Objednávka č. {order.number}
            {waiting ? <ExpiryStatus expiresAt={order.expires_at!} role={role} /> : <Status tone={label.tone}>{label.text}</Status>}
          </h1>
          <div className="tz-ord-headsub">
            Objednáno {formatDateTime(order.created_at)} · {role === 'buyer' ? 'prodejce' : 'kupující'} <Ava id={otherId} name={otherName} />{otherName} · {how} · {payName}
          </div>
        </div>
        <div className="tz-ord-total">{kc(order.total_czk)}<small>{count} {count === 1 ? 'karta' : count <= 4 ? 'karty' : 'karet'} · {items.length} {items.length === 1 ? 'druh' : items.length <= 4 ? 'druhy' : 'druhů'}</small></div>
      </header>

      <ol className="tz-ord-steps" data-ended={ended ? '' : undefined} aria-label="Postup objednávky">
        {stepView.map((s) => (
          <li key={s.key} data-s={s.state} aria-current={s.state === 'cur' || s.state === 'warn' ? 'step' : undefined}>
            <i>{s.state === 'done' ? CHECK : s.state === 'x' ? XI : null}</i>
            <b>{s.label}</b>
            <span>{s.sub || ' '}</span>
          </li>
        ))}
      </ol>
      <div className="tz-ord-progress" aria-hidden="true">
        <div>{stepView.map((s) => <i key={s.key} data-s={s.state} />)}</div>
        <p><b>{curView.label}</b><span>{(cur >= 0 ? cur : stepView.length - 1) + 1} / {stepView.length}</span></p>
      </div>

      {report ? <ReportStrip number={report.number} /> : null}
      {nowBox}

      <div className="tz-ord-grid">
        <div className="tz-ord-col">
          <OrderItems orderId={order.id} items={items} pack={packing} sums={sums} />
        </div>
        <aside className="tz-ord-col">
          {role === 'seller' ? <>{place}{party}</> : <>{party}{place}</>}
          {history.length ? (
            <details className="tz-ord-box tz-ord-fold">
              <summary><h2>Historie</h2><span>{history.length} {history.length === 1 ? 'událost' : history.length <= 4 ? 'události' : 'událostí'}</span></summary>
              <ol className="tz-ord-tl">
                {history.map((h, n) => <li key={n}><i /><div><b>{h.body}</b><span>{formatDateTime(h.at)}</span></div></li>)}
              </ol>
            </details>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

const zipText = (z: string | null) => (z ?? '').replace(/^(\d{3})(\d{2})$/, '$1 $2');

/** Kam poslat (prodejce, s Kopírovat), Doručení (kupující) nebo Předání (DS Orders, „Kam poslat“ beze změny). */
function DeliveryCard({ d, o, role }: { d?: DeliveryRow | null; o: OrderRow; role: 'buyer' | 'seller' }) {
  if (o.delivery === 'pickup') {
    return (
      <section className="tz-ord-box" aria-labelledby="misto">
        <div className="tz-ord-box-h"><h2 id="misto">Předání</h2></div>
        <p className="tz-ord-dl">Osobní předání{o.payment === 'cash' ? ', platba hotově na místě' : ''}.<br /><span className="muted">Místo a čas domluvte ve zprávách.</span></p>
      </section>
    );
  }
  const title = role === 'seller' ? 'Kam poslat' : 'Doručení';
  if (!d) {
    if (role === 'seller' && o.status === 'requested' && (o.ship_city || o.pickup_point)) {
      return (
        <section className="tz-ord-box" aria-labelledby="misto">
          <div className="tz-ord-box-h"><h2 id="misto">{title}</h2></div>
          <dl className="tz-ord-kv">
            {o.pickup_point ? <><dt>Místo</dt><dd>{o.pickup_point}</dd><dd /></> : <><dt>Město</dt><dd>{o.ship_city}</dd><dd /></>}
          </dl>
          <p className="tz-ord-paynote">Jméno a telefon kupujícího uvidíte po potvrzení objednávky.</p>
        </section>
      );
    }
    return null;
  }
  const address = d.point_name
    ? [d.point_name, d.point_address].filter(Boolean).join(', ')
    : `${d.street}, ${zipText(d.zip)} ${d.city}${d.country === 'SK' ? ', Slovensko' : ''}`;
  if (role === 'buyer') {
    return (
      <section className="tz-ord-box" aria-labelledby="misto">
        <div className="tz-ord-box-h"><h2 id="misto">{title}</h2></div>
        <p className="tz-ord-dl">
          {d.point_name ? <>{d.point_name}<br />{d.point_address}</> : <>{d.street}<br />{zipText(d.zip)} {d.city}{d.country === 'SK' ? ', Slovensko' : ''}</>}
          <br /><span className="muted">{[d.recipient, d.phone].filter(Boolean).join(' · ')}</span>
        </p>
      </section>
    );
  }
  const all = [d.recipient, address, d.point_id ? `ID ${d.point_id}` : null, d.phone].filter(Boolean).join('\n');
  const rows: Array<[string, string, boolean?]> = d.point_name
    ? [['Místo', d.point_name], ...(d.point_address ? [['Adresa', d.point_address] as [string, string]] : []), ...(d.point_id ? [['ID místa', d.point_id, true] as [string, string, boolean]] : []), ['Příjemce', d.recipient], ...(d.phone ? [['Telefon', d.phone, true] as [string, string, boolean]] : [])]
    : [['Jméno', d.recipient], ['Adresa', address], ...(d.phone ? [['Telefon', d.phone, true] as [string, string, boolean]] : [])];
  return (
    <section className="tz-ord-box" aria-labelledby="misto">
      <div className="tz-ord-box-h"><h2 id="misto">{title}</h2><span className="tz-ord-box-tools"><CopyButton text={all} label="Kopírovat vše" className="tz-btn tz-btn-secondary tz-btn-sm" /></span></div>
      <dl className="tz-ord-kv tz-ord-kv-addr">
        {rows.map(([k, v, code]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd className={code ? 'tz-ord-num' : undefined}>{v}</dd>
            <dd><CopyButton text={v} className="tz-ord-copy" /></dd>
          </div>
        ))}
      </dl>
      <p className="tz-ord-paynote">Zásilku podáte pod svým účtem u dopravce. Údaje se smažou 30 dní po uzavření objednávky.</p>
    </section>
  );
}
