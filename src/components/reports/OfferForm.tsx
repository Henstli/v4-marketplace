'use client';

import { useState } from 'react';
import { formatPrice } from '@/lib/format';
import { OFFER, type OfferKind } from '@/lib/reports';
import { Step } from './Step';
import styles from './reports.module.css';

/**
 * Nabídka řešení u „Karta neodpovídá popisu“ (DS Reports, obrazovka 5).
 * Prodejce vybírá ze 4 druhů, kupující navrhuje jinou částku nebo vrácení karty.
 */
export function OfferForm({ id, items, total, shipping, role }: { id: string; items: number; total: number; shipping: number; role: 'buyer' | 'seller' }) {
  const kinds: OfferKind[] = role === 'seller' ? ['partial', 'difference', 'return', 'refund_keep'] : ['partial', 'return'];
  const [kind, setKind] = useState<OfferKind>('partial');
  const [unit, setUnit] = useState<'pct' | 'czk'>(role === 'seller' ? 'pct' : 'czk');
  const [amount, setAmount] = useState(role === 'seller' ? '10' : '');
  const n = Number(amount.replace(/\s/g, '').replace(',', '.'));
  const czk = Number.isFinite(n) && n > 0 ? Math.round(unit === 'pct' ? (items * n) / 100 : n) : 0;
  const money = kind === 'partial' || kind === 'difference';
  return (
    <Step id={id} op="offer" label={role === 'seller' ? 'Poslat nabídku' : kind === 'return' ? 'Chci vrátit kartu' : 'Navrhnout částku'}>
      <span className="t-label muted">{role === 'seller' ? 'CO NABÍDNETE' : 'CO NAVRHUJETE'}</span>
      <div className={styles.segment} role="radiogroup" aria-label="Nabídka">
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={styles.seg} onClick={() => setKind(k)}>
            {role === 'buyer' && k === 'partial' ? 'Jiná částka' : OFFER[k]}
          </button>
        ))}
      </div>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="base" value={items} />
      {money ? (
        <>
          <div className={styles.amountRow}>
            <label className={styles.field}>
              <span className="t-small muted">Kolik</span>
              <input name="amount" inputMode="decimal" className={`${styles.input} code`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <div className={styles.unit}>
              <button type="button" aria-pressed={unit === 'pct'} onClick={() => setUnit('pct')}>%</button>
              <button type="button" aria-pressed={unit === 'czk'} onClick={() => setUnit('czk')}>Kč</button>
            </div>
          </div>
          <span className="t-small">
            {role === 'seller' ? 'Pošlete kupujícímu' : 'Prodejce vám pošle'} <strong className="code">{formatPrice(czk)}</strong> z ceny karet {formatPrice(items)}. Karta {role === 'seller' ? 'mu' : 'vám'} zůstane.
          </span>
        </>
      ) : kind === 'return' ? (
        <span className="t-small">Kupující pošle kartu zpět a prodejce vrátí <strong className="code">{formatPrice(total)}</strong> (karty a doprava) a zpáteční dopravu do {formatPrice(shipping)}.</span>
      ) : (
        <span className="t-small">Prodejce vrátí <strong className="code">{formatPrice(items)}</strong> za karty a karta zůstane kupujícímu.</span>
      )}
      <label className={styles.field}>
        <span className="t-small muted">Poznámka (nepovinná)</span>
        <input name="note" maxLength={500} className={styles.input} />
      </label>
    </Step>
  );
}
