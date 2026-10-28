'use client';

import { useState, type ReactNode } from 'react';
import { Price } from '@/components/trezor';
import styles from './prepay.module.css';

type Method = 'bank' | 'paypal' | 'revolut';
const LABEL: Record<Method, string> = { bank: 'QR převod', paypal: 'PayPal', revolut: 'Revolut' };

/** Hodnota s odkazem Kopírovat. */
function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }).catch(() => {});
  };
  return (
    <dd className={styles.value}>
      <span className="code">{value}</span>
      <button type="button" className={styles.copy} onClick={copy} aria-label={`Kopírovat ${label}`}>{done ? 'Zkopírováno' : 'Kopírovat'}</button>
    </dd>
  );
}

/**
 * Platba předem (DS OrderPayment › Platba předem): přepínač QR převod / PayPal / Revolut,
 * jen se způsoby, které prodejce má. Odkazy skládáme jen na paypal.me a revolut.me.
 * Předvyplnění revolut.me (currency, amount v haléřích, note) Revolut nedokumentuje, proto zůstávají údaje ke kopírování.
 */
export function PrepayTabs({ bank, paypalMe, revtag, amount, vs, role = 'buyer' }: {
  /** Obsah pro převod (QR a údaje), null když ho prodejce nenabízí */
  bank: ReactNode | null;
  paypalMe: string | null;
  revtag: string | null;
  amount: number;
  vs: number;
  role?: 'buyer' | 'seller';
}) {
  const methods = ([bank ? 'bank' : null, paypalMe ? 'paypal' : null, revtag ? 'revolut' : null] as const).filter(Boolean) as Method[];
  const [picked, setPicked] = useState<Method>(methods[0] ?? 'bank');
  const current = methods.includes(picked) ? picked : methods[0];
  if (!current) return null;
  const note = `Objednávka ${vs}`;
  return (
    <div className={styles.wrap}>
      {methods.length > 1 ? (
        <div className={styles.tabs} role="tablist" aria-label="Způsob platby">
          {methods.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={m === current} className={styles.tab} onClick={() => setPicked(m)}>{LABEL[m]}</button>
          ))}
        </div>
      ) : null}
      {current === 'bank' ? bank : current === 'paypal' && paypalMe ? (
        <div className={styles.body}>
          <dl className={styles.lines}>
            <div className={styles.row}><dt>Částka</dt><dd className={styles.amount}><Price amount={amount} /></dd></div>
            <div className={styles.row}><dt>PayPal</dt><Copy value={`paypal.me/${paypalMe}`} label="PayPal" /></div>
          </dl>
          {role === 'buyer' ? (
            <a className="tz-btn tz-btn-primary tz-btn-md" href={`https://paypal.me/${encodeURIComponent(paypalMe)}/${amount}CZK`} target="_blank" rel="noopener noreferrer">Otevřít PayPal</a>
          ) : null}
          <p className="t-small muted">Zvolte platbu za zboží, jinak nemáte ochranu kupujícího PayPal.</p>
        </div>
      ) : revtag ? (
        <div className={styles.body}>
          <dl className={styles.lines}>
            <div className={styles.row}><dt>Částka</dt><dd className={styles.amount}><Price amount={amount} /></dd></div>
            <div className={styles.row}><dt>Revtag</dt><Copy value={`@${revtag}`} label="Revtag" /></div>
            <div className={styles.row}><dt>Poznámka</dt><Copy value={note} label="poznámku" /></div>
          </dl>
          {role === 'buyer' ? (
            <a className="tz-btn tz-btn-primary tz-btn-md" href={`https://revolut.me/${encodeURIComponent(revtag)}?currency=CZK&amount=${amount * 100}&note=${encodeURIComponent(note)}`} target="_blank" rel="noopener noreferrer">Otevřít Revolut</a>
          ) : null}
          <p className="t-small muted">Když aplikace Revolut částku nebo poznámku nevyplní, vložte je ručně.</p>
        </div>
      ) : null}
    </div>
  );
}
