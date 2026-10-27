'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, CardThumb, Price, Status, type StatusTone } from '@/components/trezor';
import { ExpiryStatus, useLeft } from '@/components/orders/Expiry';
import { ShipChangeBlock } from '@/components/orders/ShipChange';
import { sendMessage } from '@/app/zpravy/actions';
import { setOrderStatus } from '@/app/objednavky/actions';
import { ShipEdit } from '@/app/objednavky/ShipEdit';
import { answerOffer, proposePrice } from '@/app/zpravy/offers';
import { formatDateTime, formatPrice, plural } from '@/lib/format';
import type { ChatMessage, ChatOffer, ChatOrder, ListingRef, MyListing } from '@/lib/messages';
import { canChangeShipping, flowActions, flowSteps, orderLabel, type FlowAction } from '@/lib/order-flow';
import { ORDER_STATUS_SHORT, ORDER_TONE } from '@/lib/order-status';
import styles from './messages.module.css';

// Zprávy jednoho odesílatele do 5 minut tvoří skupinu, čas je až pod poslední z nich.
const GROUP_MS = 5 * 60_000;

// Den a čas v českém čase: oddělovač DNES / VČERA / 25. 10. a pod zprávou jen hodina.
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/Prague' });
function dayLabel(iso: string): string {
  const key = dayKey(iso);
  if (key === dayKey(new Date().toISOString())) return 'Dnes';
  if (key === dayKey(new Date(Date.now() - 86_400_000).toISOString())) return 'Včera';
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Europe/Prague' });
}

// U skončených objednávek není na stránce Objednávky co dělat, odkaz se nezobrazí.
const ENDED = new Set(['cancelled', 'declined', 'expired']);

function ListingLink({ l, mine }: { l: ListingRef; mine: boolean }) {
  return (
    <Link href={`/karty/${l.cardSlug}`} className={styles.ref} data-mine={mine ? '' : undefined}>
      <CardThumb image={l.image ?? undefined} size="sm" />
      <span className={styles.refText}>
        <span className={styles.refName}>{l.cardName}{l.setLabel ? ` · ${l.setLabel}` : ''}</span>
        <span className={styles.refMeta}>{l.condition} · {l.language} · {l.price != null ? <Price amount={l.price} /> : 'cena dohodou'}</span>
      </span>
    </Link>
  );
}

// Změna stavu objednávky z chatu (stejná akce jako na stránce Objednávky).
function StatusSubmit({ variant, children }: { variant: 'primary' | 'secondary' | 'ghost'; children: ReactNode }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} disabled={pending} className={styles.ordBtn}>{pending ? 'Ukládám…' : children}</Button>;
}
function StepForm({ id, action }: { id: string; action: FlowAction }) {
  const tracking = action.op === 'status' && action.tracking;
  return (
    <form action={setOrderStatus} className={tracking ? styles.ordTrack : undefined}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={action.op} />
      {action.op === 'status' ? <input type="hidden" name="status" value={action.status} /> : null}
      {tracking ? <input name="tracking" maxLength={60} className="code" placeholder="Číslo zásilky" aria-label="Číslo zásilky (nepovinné)" /> : null}
      <StatusSubmit variant={action.variant}>{action.label}</StatusSubmit>
    </form>
  );
}

/** Akce podle role (DS DeliveryPayment): bublinu posílá kupující, takže u kupujícího je mine = true. */
function OrderActions({ o, buyer }: { o: ChatOrder; buyer: boolean }) {
  const actions = flowActions(o, buyer ? 'buyer' : 'seller');
  return actions.length ? <div className={styles.ordActions}>{actions.map((a) => <StepForm key={a.label} id={o.id} action={a} />)}</div> : null;
}

/** Objednávka jako bublina od kupujícího (DS Messages, varianta A s pruhem postupu). */
function OrderBubble({ o, mine }: { o: ChatOrder; mine: boolean }) {
  const ended = ENDED.has(o.status);
  const steps = flowSteps(o);
  const label = orderLabel(o, mine ? 'buyer' : 'seller', true);
  return (
    <div className={`${styles.ord} ${mine ? '' : styles.ordThem} ${ended ? styles.ordEnded : ''}`}>
      <div className={styles.ordTop}>
        <strong>Objednávka č. <span className="code">{o.number}</span></strong>
        {o.status === 'requested' && o.expiresAt ? (
          <ExpiryStatus expiresAt={o.expiresAt} role={mine ? 'buyer' : 'seller'} />
        ) : (
          <Status tone={label.tone}>{label.text}</Status>
        )}
      </div>
      <ul className={styles.ordItems}>
        {o.items.map((it, n) => (
          <li key={n}>
            <span>
              {it.name} <small className="code">{it.condition}</small>
              {it.quantity > 1 ? <small> × {it.quantity}</small> : null}
            </span>
            <Price amount={it.price * it.quantity} />
          </li>
        ))}
      </ul>
      <div className={styles.ordSum}>
        <span>
          {plural(o.count, ['karta', 'karty', 'karet'])} · {o.pickup ? o.deliveryLine : `${o.carrierName} ${o.shipping ? formatPrice(o.shipping) : 'zdarma'}${o.paymentName ? ` · ${o.paymentName}` : ''}`}
        </span>
        <span className={styles.ordTotal}><Price amount={o.total} /></span>
      </div>
      {ended ? null : (
        <>
          <ol className={styles.track} aria-label="Postup objednávky">
            {steps.map((s) => (
              <li key={s.key} data-done={s.done ? '' : undefined}>{s.label}</li>
            ))}
          </ol>
          {o.shipChange != null && (o.status === 'requested' || o.status === 'confirmed') ? (
            <ShipChangeBlock
              shipping={o.shipping}
              change={o.shipChange}
              total={o.total}
              reason={o.shipChangeReason}
              role={mine ? 'buyer' : 'seller'}
              requested={o.status === 'requested'}
              transfer={(o.payment ?? 'transfer') === 'transfer'}
            />
          ) : null}
          {!mine && canChangeShipping(o) ? (
            <ShipEdit
              key={o.shipChange ?? o.shipping}
              id={o.id}
              carrier={o.carrierName}
              shipping={o.shipChange ?? o.shipping}
              total={o.total - o.shipping + (o.shipChange ?? o.shipping)}
              cap={o.shipCap}
            />
          ) : null}
          <OrderActions o={o} buyer={mine} />
          <Link href={`/objednavky/${o.number}`} className="t-small">Zobrazit objednávku</Link>
        </>
      )}
    </div>
  );
}

// Štítek návrhu ceny (DS Messages, Návrh ceny).
const OFFER_STATUS: Record<ChatOffer['status'], [string, StatusTone]> = {
  open: ['Čeká na odpověď', 'info'],
  accepted: ['Přijato', 'ok'],
  declined: ['Odmítnuto', 'danger'],
  cancelled: ['Staženo', 'muted'],
  expired: ['Vypršelo', 'muted'],
  sold_out: ['Prodáno jinde', 'muted'],
};

/** Návrh ceny jako bublina na straně toho, kdo cenu poslal; akce jen u nejnovější ceny otevřeného návrhu. */
function OfferBubble({ o, l, mine, sellerSent, other }: { o: ChatOffer; l: ListingRef | null; mine: boolean; sellerSent: boolean; other: string }) {
  const router = useRouter();
  const [counter, setCounter] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const old = !o.current;
  // Po 48 hodinách návrh vyprší hned, i když ho databáze (cron po 10 min) ještě nezavřela.
  const left = useLeft(o.expiresAt);
  const expired = o.status === 'open' && left <= 0;
  const [label, tone] = old ? ['Nahrazeno', 'muted' as StatusTone] : expired ? OFFER_STATUS.expired : OFFER_STATUS[o.status];
  const open = o.current && o.status === 'open' && !expired;
  const run = (fn: () => Promise<{ error?: string; orderNumber?: number }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) return setError(r.error);
      setCounter(false);
      router.refresh();
    });
  };
  const price = o.price ?? 0;
  return (
    <div className={`${styles.ofr} ${mine ? '' : styles.ordThem} ${old || !open ? styles.ofrDone : ''}`}>
      <div className={styles.ordTop}>
        <strong>{sellerSent ? 'Cena od prodejce' : 'Návrh ceny'}</strong>
        {open ? (
          <ExpiryStatus expiresAt={o.expiresAt} role={o.lastByMe ? 'buyer' : 'seller'} label={o.lastByMe ? 'Čeká na odpověď' : 'Čeká na vás'} act="Odpovězte do" />
        ) : <Status tone={tone}>{label}</Status>}
      </div>
      {l ? (
        <Link href={`/karty/${l.cardSlug}`} className={styles.ofrCard}>
          <CardThumb image={l.image ?? undefined} size="sm" />
          <span className={styles.refText}>
            <span className={styles.refName}>{l.cardName}{l.setLabel ? ` · ${l.setLabel}` : ''}</span>
            <span className={styles.refMeta}>{l.condition} · {l.language} · {o.quantity}&nbsp;ks</span>
          </span>
        </Link>
      ) : null}
      <div className={styles.ofrPrice}>
        <span className={old ? styles.ofrOld : undefined}>{formatPrice(price)}</span>
        {o.previous != null && !old ? <s>{formatPrice(o.previous)}</s> : null}
        {o.quantity > 1 ? <small> za kus</small> : null}
      </div>
      {o.current && o.status === 'accepted' && o.orderNumber ? (
        <Link href={`/objednavky/${o.orderNumber}`} className="t-small">Objednávka č. {o.orderNumber}</Link>
      ) : null}
      {open ? (
        <>
          <span className="t-small muted">Platí do {formatDateTime(o.expiresAt)}, pak návrh zmizí</span>
          {counter ? (
            <form
              className={styles.ofrCounter}
              action={(f) => run(() => proposePrice(l?.id ?? '', Number(f.get('price')), o.quantity, o.buyer ? null : other))}
            >
              <input name="price" type="number" min={1} step={1} required inputMode="numeric" autoFocus aria-label="Vaše cena za kus v Kč" placeholder="Kč" className={styles.ofrInput} />
              <Button type="submit" disabled={pending} className={styles.ordBtn}>Poslat</Button>
              <Button variant="ghost" onClick={() => setCounter(false)} className={styles.ordBtn}>Zpět</Button>
            </form>
          ) : (
            <div className={styles.ordActions}>
              {o.lastByMe ? (
                <Button variant="ghost" disabled={pending} className={styles.ordBtn} onClick={() => run(() => answerOffer(o.id, o.buyer ? 'cancel' : 'decline'))}>Stáhnout návrh</Button>
              ) : (
                <>
                  <Button disabled={pending} className={styles.ordBtn} onClick={() => run(() => answerOffer(o.id, 'accept'))}>Přijmout {formatPrice(price * o.quantity)}</Button>
                  <Button variant="secondary" disabled={pending} className={styles.ordBtn} onClick={() => setCounter(true)}>Jiná cena</Button>
                  <Button variant="ghost" disabled={pending} className={styles.ordBtn} onClick={() => run(() => answerOffer(o.id, o.buyer ? 'cancel' : 'decline'))}>Odmítnout</Button>
                </>
              )}
            </div>
          )}
          {error ? <p className="t-small" role="alert">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
}

export function Thread({ to, name, messages, initialText, listing, wasUnread, myListings = [] }: {
  to: string;
  name: string;
  messages: ChatMessage[];
  initialText: string;
  /** Nabídka, ke které se píše dotaz (z katalogu karty) */
  listing?: ListingRef | null;
  /** Konverzace byla při otevření nepřečtená (stránka ji právě označila jako přečtenou) */
  wasUnread?: boolean;
  /** Moje nabídky skladem: z nich jde druhé straně navrhnout cenu */
  myListings?: MyListing[];
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [about, setAbout] = useState<ListingRef | null>(listing ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [proposing, setProposing] = useState(false);
  // Předvybraná nabídka: poslední moje nabídka, o které byla v konverzaci řeč.
  const mineIds = new Set(myListings.map((l) => l.id));
  const lastAbout = [...messages].reverse().find((m) => m.listing && mineIds.has(m.listing.id))?.listing?.id;
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const last = messages.at(-1)?.id;

  // Právě přečtená konverzace: hned zhasnout počet v hlavičce i zvýraznění v seznamu
  // (seznam je v layoutu, který se při přechodu mezi konverzacemi sám nenačte).
  useEffect(() => {
    if (!wasUnread) return;
    window.dispatchEvent(new Event('v4-messages-read'));
    router.refresh();
  }, [wasUnread, to, router]);

  // Při nové zprávě dolů.
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [last]);

  // Pole roste s textem do 6 řádků.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 6 * 21 + 20)}px`;
  }, [text]);

  const send = () => {
    const body = text.trim();
    if (!body || pending) return;
    setError(null);
    start(async () => {
      const r = await sendMessage(to, body, about?.id);
      if (r.error) return setError(r.error);
      setText('');
      // Odkaz na nabídku patří jen k první zprávě.
      setAbout(null);
      if (listing) router.replace(`/zpravy/${to}`, { scroll: false });
      router.refresh();
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const renderMessage = (m: ChatMessage, i: number) => {
    if (m.kind === 'order') {
      return (
        <div key={m.id} className={styles.orderWrap} data-mine={m.mine ? '' : undefined}>
          {m.order ? <OrderBubble o={m.order} mine={m.mine} /> : <div className={styles.event}>{m.body}</div>}
          <span className={styles.time}>{m.mine ? 'Vy' : name} · {clock(m.createdAt)}</span>
        </div>
      );
    }
    if (m.kind === 'status' && m.offer && m.offer.price != null) {
      return (
        <div key={m.id} className={styles.orderWrap} data-mine={m.mine ? '' : undefined}>
          <OfferBubble o={m.offer} l={m.listing} mine={m.mine} sellerSent={m.mine !== m.offer.buyer} other={to} />
          <span className={styles.time}>{m.mine ? 'Vy' : name} · {clock(m.createdAt)}</span>
        </div>
      );
    }
    if (m.kind === 'status') {
      return <p key={m.id} className={styles.event}>{m.body} · {clock(m.createdAt)}</p>;
    }
    const next = messages[i + 1];
    const groupEnd = !next || next.kind !== 'text' || next.mine !== m.mine
      || Date.parse(next.createdAt) - Date.parse(m.createdAt) > GROUP_MS;
    return (
      <div key={m.id} className={styles.msgWrap} data-mine={m.mine ? '' : undefined}>
        {m.listing ? <ListingLink l={m.listing} mine={m.mine} /> : null}
        <div className={`${styles.bubble} ${m.mine ? styles.me : styles.them}`}>{m.body}</div>
        {groupEnd ? <span className={styles.time}>{clock(m.createdAt)}</span> : null}
      </div>
    );
  };

  return (
    <>
      <div className={styles.msgs} ref={box} aria-live="polite">
        {messages.length ? messages.map((m, i) => {
          const newDay = i === 0 || dayKey(messages[i - 1].createdAt) !== dayKey(m.createdAt);
          return (
            <Fragment key={m.id}>
              {newDay ? <div className={styles.day} suppressHydrationWarning>{dayLabel(m.createdAt)}</div> : null}
              {renderMessage(m, i)}
            </Fragment>
          );
        }) : (
          <p className={`muted ${styles.start}`}>Začněte konverzaci s {name}. Zpráva přijde i e-mailem.</p>
        )}
      </div>
      {proposing ? (
        <ProposeForm to={to} listings={myListings} initial={lastAbout} onDone={() => { setProposing(false); router.refresh(); }} onCancel={() => setProposing(false)} />
      ) : null}
      <form className={styles.compose} onSubmit={(e) => { e.preventDefault(); send(); }}>
        {about ? (
          <div className={styles.ctx}>
            <CardThumb image={about.image ?? undefined} size="sm" />
            <span className={styles.ctxText}>
              Dotaz k nabídce: <strong>{about.cardName}{about.setLabel ? ` · ${about.setLabel}` : ''}</strong> · {about.condition} · {about.price != null ? <Price amount={about.price} /> : 'cena dohodou'}
            </span>
            <button type="button" className={styles.ctxClose} onClick={() => setAbout(null)} aria-label="Zrušit odkaz na nabídku">×</button>
          </div>
        ) : null}
        <div className={styles.composeRow}>
          <textarea
            ref={field}
            rows={1}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="Napište zprávu…"
            aria-label="Zpráva"
            className={styles.field}
          />
          {myListings.length && !proposing ? (
            <Button variant="secondary" onClick={() => setProposing(true)} title="Navrhnout cenu k některé vaší nabídce">Navrhnout cenu</Button>
          ) : null}
          <Button type="submit" disabled={pending || !text.trim()}>{pending ? 'Odesílám…' : 'Odeslat'}</Button>
        </div>
        {error ? <p className="t-small" role="alert">{error}</p> : null}
        <p className={styles.hint}>Plaťte jen na účet uvedený u objednávky. Nikomu neposílejte hesla ani údaje z platební karty.</p>
      </form>
    </>
  );
}

/** Prodejce navrhne cenu k některé své nabídce (DS Messages, Návrh ceny). */
function ProposeForm({ to, listings, initial, onDone, onCancel }: {
  to: string;
  listings: MyListing[];
  initial?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(initial ?? listings[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const l = listings.find((x) => x.id === id);
  return (
    <form
      className={styles.propose}
      action={(f) => {
        setError(null);
        start(async () => {
          const r = await proposePrice(id, Number(f.get('price')), Number(f.get('quantity') ?? 1), to);
          if (r.error) return setError(r.error);
          onDone();
        });
      }}
    >
      <label className={styles.proposeWide}>
        <span className="t-label muted">NABÍDKA</span>
        <select value={id} onChange={(e) => setId(e.target.value)} className={styles.ofrInput}>
          {listings.map((x) => (
            <option key={x.id} value={x.id}>{x.label} · {x.price != null ? formatPrice(x.price) : 'dohodou'}{x.quantity > 1 ? ` · ${x.quantity} ks` : ''}</option>
          ))}
        </select>
      </label>
      {l && l.quantity > 1 ? (
        <label>
          <span className="t-label muted">KUSŮ</span>
          <input key={id} name="quantity" type="number" min={1} max={l.quantity} defaultValue={1} className={styles.ofrInput} />
        </label>
      ) : null}
      <label>
        <span className="t-label muted">CENA ZA KUS (KČ)</span>
        <input name="price" type="number" min={1} step={1} required inputMode="numeric" autoFocus className={styles.ofrInput} />
      </label>
      <div className={styles.proposeActions}>
        <Button type="submit" disabled={pending || !id}>{pending ? 'Posílám…' : 'Poslat návrh'}</Button>
        <Button variant="ghost" onClick={onCancel}>Zrušit</Button>
      </div>
      {error ? <p className="t-small" role="alert">{error}</p> : null}
    </form>
  );
}
