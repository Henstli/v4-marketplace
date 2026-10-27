'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/trezor';
import { changeShipping, type ShipChangeState } from './actions';
import styles from './orders.module.css';

const REASONS = ['Těžší nebo větší zásilka', 'Víc kusů v krabici', 'Pojištění zásilky', 'Jiný důvod'];
const kc = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`;

/** Prodejce: „Upravit dopravu“ u potvrzené objednávky před zaplacením (DS DeliveryPayment). */
export function ShipEdit({ id, shipping, total, cap }: { id: string; shipping: number; total: number; cap: number | null }) {
  const [state, action, pending] = useActionState<ShipChangeState, FormData>(changeShipping, {});
  // Otevřeno od stavu `opened`; po úspěšném odeslání se formulář zavře.
  const [opened, setOpened] = useState<ShipChangeState | null>(null);
  const open = opened !== null && (state === opened || !state.ok);
  const [price, setPrice] = useState(shipping);
  const [reason, setReason] = useState(REASONS[0]);
  if (!open) return <Button variant="ghost" onClick={() => { setOpened(state); setPrice(shipping); }}>Upravit dopravu</Button>;
  const lower = price < shipping;
  return (
    <form action={action} className={styles.shipEdit}>
      <input type="hidden" name="id" value={id} />
      <strong>Upravit dopravu</strong>
      <div className={styles.shipPrices}>
        <label className={styles.field}>
          <span className="t-label muted">DOPRAVA TEĎ</span>
          <span className={`${styles.input} ${styles.readonly} code`}>{kc(shipping)}</span>
        </label>
        <label className={styles.field}>
          <span className="t-label muted">NOVÁ CENA</span>
          <input name="price" type="number" min={0} max={cap ?? 1000} required value={price} onChange={(e) => setPrice(Number(e.target.value) || 0)} className={`${styles.input} code`} />
          {cap ? <span className="t-small muted">nejvýš {kc(cap)}</span> : null}
        </label>
      </div>
      <fieldset className={styles.reasons}>
        <legend className="t-label muted">DŮVOD (UVIDÍ KUPUJÍCÍ)</legend>
        <div className={styles.reasonChips}>
          {REASONS.map((r) => (
            <label key={r} className={styles.reasonChip}>
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
              <span>{r}</span>
            </label>
          ))}
        </div>
        <input name="note" maxLength={150} required={reason === 'Jiný důvod'} className={styles.input} placeholder="Např. 3 boxy v krabici, přes 5 kg" aria-label="Poznámka pro kupujícího" />
      </fieldset>
      <div className={styles.shipFoot}>
        <span className="t-small muted">
          Celkem <s className="code">{kc(total)}</s> → <strong className="code">{kc(total - shipping + price)}</strong>
        </span>
        <span className={styles.shipBtns}>
          <Button variant="ghost" onClick={() => setOpened(null)}>Zrušit</Button>
          <Button type="submit" disabled={pending || price === shipping}>{lower ? 'Snížit dopravu' : 'Poslat kupujícímu'}</Button>
        </span>
      </div>
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <p className="t-small muted">
        {lower ? 'Nižší cena platí hned, kupující ji nemusí schvalovat.' : 'Vyšší cenu musí kupující potvrdit. Do té doby nevidí QR kód a může objednávku zrušit bez následků.'}
      </p>
    </form>
  );
}
