'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, CardThumb, Price, Status } from '@/components/trezor';
import { ExpiryStatus } from '@/components/orders/Expiry';
import { sendMessage } from '@/app/zpravy/actions';
import { setOrderStatus } from '@/app/objednavky/actions';
import { formatPrice, plural } from '@/lib/format';
import type { ChatMessage, ChatOrder, ListingRef } from '@/lib/messages';
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
        <span className={styles.refMeta}>{l.condition} · {l.language} · <Price amount={l.price} /></span>
      </span>
    </Link>
  );
}

// Pruh postupu objednávky: kolik kroků je hotových podle stavu.
const STEPS = ['Odesláno', 'Potvrzeno', 'Zaplaceno a odesláno', 'Převzato'];
const STEP_DONE: Record<string, number> = { requested: 1, confirmed: 2, pending_payment: 2, paid: 3, shipped: 3, delivered: 4 };

// Změna stavu objednávky z chatu (stejná akce jako na stránce Objednávky).
function StatusSubmit({ variant, children }: { variant: 'primary' | 'secondary' | 'ghost'; children: ReactNode }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} disabled={pending} className={styles.ordBtn}>{pending ? 'Ukládám…' : children}</Button>;
}
function StatusForm({ id, status, variant, children }: { id: string; status: string; variant: 'primary' | 'secondary' | 'ghost'; children: ReactNode }) {
  return (
    <form action={setOrderStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <StatusSubmit variant={variant}>{children}</StatusSubmit>
    </form>
  );
}

/** Akce podle role: bublinu posílá kupující, takže u kupujícího je mine = true. */
function OrderActions({ o, buyer }: { o: ChatOrder; buyer: boolean }) {
  const forms: ReactNode[] = [];
  if (!buyer && o.status === 'requested') {
    forms.push(<StatusForm key="c" id={o.id} status="confirmed" variant="primary">Potvrdit objednávku</StatusForm>);
    forms.push(<StatusForm key="d" id={o.id} status="declined" variant="ghost">Odmítnout</StatusForm>);
  }
  if (buyer && o.status === 'requested') forms.push(<StatusForm key="x" id={o.id} status="cancelled" variant="ghost">Zrušit objednávku</StatusForm>);
  if (!buyer && (o.status === 'confirmed' || o.status === 'paid')) forms.push(<StatusForm key="s" id={o.id} status="shipped" variant="secondary">Označit jako odeslané</StatusForm>);
  if (buyer && (o.status === 'confirmed' || o.status === 'shipped')) forms.push(<StatusForm key="r" id={o.id} status="delivered" variant="secondary">Potvrdit převzetí</StatusForm>);
  return forms.length ? <div className={styles.ordActions}>{forms}</div> : null;
}

/** Objednávka jako bublina od kupujícího (DS Messages, varianta A s pruhem postupu). */
function OrderBubble({ o, mine }: { o: ChatOrder; mine: boolean }) {
  const ended = ENDED.has(o.status);
  const done = STEP_DONE[o.status] ?? 0;
  return (
    <div className={`${styles.ord} ${mine ? '' : styles.ordThem} ${ended ? styles.ordEnded : ''}`}>
      <div className={styles.ordTop}>
        <strong>Objednávka č. <span className="code">{o.number}</span></strong>
        {o.status === 'requested' && o.expiresAt ? (
          <ExpiryStatus expiresAt={o.expiresAt} role={mine ? 'buyer' : 'seller'} />
        ) : (
          <Status tone={ORDER_TONE[o.status] ?? 'muted'}>{ORDER_STATUS_SHORT[o.status] ?? o.status}</Status>
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
        <span>{plural(o.count, ['karta', 'karty', 'karet'])} · {o.pickup ? 'osobní předání' : o.shipping ? `doprava ${formatPrice(o.shipping)}` : 'doprava zdarma'}</span>
        <span className={styles.ordTotal}><Price amount={o.total} /></span>
      </div>
      {ended ? null : (
        <>
          <ol className={styles.track} aria-label="Postup objednávky">
            {STEPS.map((label, n) => (
              <li key={label} data-done={n < done ? '' : undefined}>{label}</li>
            ))}
          </ol>
          <OrderActions o={o} buyer={mine} />
          <Link href={`/objednavky/${o.number}`} className="t-small">Zobrazit objednávku</Link>
        </>
      )}
    </div>
  );
}

export function Thread({ to, name, messages, initialText, listing, wasUnread }: {
  to: string;
  name: string;
  messages: ChatMessage[];
  initialText: string;
  /** Nabídka, ke které se píše dotaz (z katalogu karty) */
  listing?: ListingRef | null;
  /** Konverzace byla při otevření nepřečtená (stránka ji právě označila jako přečtenou) */
  wasUnread?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [about, setAbout] = useState<ListingRef | null>(listing ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
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
      <form className={styles.compose} onSubmit={(e) => { e.preventDefault(); send(); }}>
        {about ? (
          <div className={styles.ctx}>
            <CardThumb image={about.image ?? undefined} size="sm" />
            <span className={styles.ctxText}>
              Dotaz k nabídce: <strong>{about.cardName}{about.setLabel ? ` · ${about.setLabel}` : ''}</strong> · {about.condition} · <Price amount={about.price} />
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
          <Button type="submit" disabled={pending || !text.trim()}>{pending ? 'Odesílám…' : 'Odeslat'}</Button>
        </div>
        {error ? <p className="t-small" role="alert">{error}</p> : null}
        <p className={styles.hint}>Plaťte jen na účet uvedený u objednávky. Nikomu neposílejte hesla ani údaje z platební karty.</p>
      </form>
    </>
  );
}
