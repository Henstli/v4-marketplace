'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { Button, CardThumb, Price, Status } from '@/components/trezor';
import { sendMessage } from '@/app/zpravy/actions';
import { formatDateTime, plural } from '@/lib/format';
import type { ChatMessage, ListingRef } from '@/lib/messages';
import { ORDER_STATUS } from '@/lib/order-status';
import styles from './messages.module.css';

// Zprávy jednoho odesílatele do 5 minut tvoří skupinu, čas je až pod poslední z nich.
const GROUP_MS = 5 * 60_000;

// Štítek stavu objednávky: čeká = warn, domluveno = ok, skončilo bez obchodu = muted.
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'muted'> = {
  requested: 'warn', pending_payment: 'warn',
  confirmed: 'ok', paid: 'ok', shipped: 'ok', delivered: 'ok',
};

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

export function Thread({ to, name, messages, initialText, listing }: {
  to: string;
  name: string;
  messages: ChatMessage[];
  initialText: string;
  /** Nabídka, ke které se píše dotaz (z katalogu karty) */
  listing?: ListingRef | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [about, setAbout] = useState<ListingRef | null>(listing ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const last = messages.at(-1)?.id;

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

  return (
    <>
      <div className={styles.msgs} ref={box} aria-live="polite">
        {messages.length ? messages.map((m, i) => {
          if (m.kind === 'order') {
            return (
              <div key={m.id} className={styles.order}>
                <div className={styles.orderTop}>
                  <span>Objednávka č. <span className="code">{m.order?.number ?? ''}</span></span>
                  {m.order ? <Price amount={m.order.total} /> : null}
                </div>
                {m.order ? (
                  <>
                    <span className="t-small muted">{plural(m.order.items, ['karta', 'karty', 'karet'])}</span>
                    <Status tone={STATUS_TONE[m.order.status] ?? 'muted'} className={styles.orderStatus}>{ORDER_STATUS[m.order.status] ?? m.order.status}</Status>
                  </>
                ) : null}
                <Link href="/objednavky" className="t-small">Zobrazit objednávku</Link>
              </div>
            );
          }
          if (m.kind === 'status') {
            return <p key={m.id} className={styles.event}>{m.body} · {formatDateTime(m.createdAt)}</p>;
          }
          const next = messages[i + 1];
          const groupEnd = !next || next.kind !== 'text' || next.mine !== m.mine
            || Date.parse(next.createdAt) - Date.parse(m.createdAt) > GROUP_MS;
          return (
            <div key={m.id} className={styles.msgWrap} data-mine={m.mine ? '' : undefined}>
              {m.listing ? <ListingLink l={m.listing} mine={m.mine} /> : null}
              <div className={`${styles.bubble} ${m.mine ? styles.me : styles.them}`}>{m.body}</div>
              {groupEnd ? <span className={styles.time}>{formatDateTime(m.createdAt)}</span> : null}
            </div>
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
