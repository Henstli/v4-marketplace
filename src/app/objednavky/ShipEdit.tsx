'use client';

import { useActionState, useEffect, useState } from 'react';
import { useNowMode } from '@/components/orders/NowMode';
import { keepForm } from '@/lib/form';
import { Button } from '@/components/trezor';
import { changeShipping, type ShipChangeState } from './actions';
import styles from './orders.module.css';

const REASONS = ['Těžší nebo větší zásilka', 'Víc kusů v krabici', 'Pojištění zásilky', 'Jiný důvod'];
const kc = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`;

/** Prodejce: řádek Doprava s Upravit od objednání do zaplacení (DS DeliveryPayment, varianta B). */
export function ShipEdit({ id, carrier, shipping, total, cap, inNow }: { id: string; carrier: string; shipping: number; total: number; cap: number | null; /** V rámečku Co teď (DS Orders): otevře se hned, zavření vrátí tlačítka. */ inNow?: boolean }) {
  const [state, action, pending] = useActionState<ShipChangeState, FormData>(changeShipping, {});
  const { setMode } = useNowMode();
  // Otevřeno od stavu `opened`; po úspěšném odeslání se formulář zavře.
  const [opened, setOpened] = useState<ShipChangeState | null>(inNow ? state : null);
  const open = opened !== null && (state === opened || !state.ok);
  useEffect(() => { if (inNow && !open) setMode(''); }, [inNow, open, setMode]);
  // Text, ať jde pole při psaní úplně smazat (prázdné = 0 Kč).
  const [draft, setDraft] = useState(String(shipping));
  const price = Number(draft) || 0;
  const [reason, setReason] = useState(REASONS[0]);
  if (!open) {
    return (
      <div className={styles.shipRow}>
        <span className={styles.shipRowText}>
          <span className="t-label muted">DOPRAVA</span>
          <span>{carrier} · <span className="code">{kc(shipping)}</span></span>
        </span>
        <button type="button" className={styles.shipRowBtn} onClick={() => { setOpened(state); setDraft(String(shipping)); }}>Upravit</button>
      </div>
    );
  }
  const lower = price < shipping;
  const over = cap != null && price > cap ? price - cap : 0;
  return (
    <form onSubmit={keepForm(action)} className={styles.shipEdit}>
      <input type="hidden" name="id" value={id} />
      <strong>Upravit dopravu</strong>
      <div className={styles.shipPrices}>
        <label className={styles.field}>
          <span className="t-label muted">DOPRAVA TEĎ</span>
          <span className={`${styles.input} ${styles.readonly} code`}>{kc(shipping)}</span>
        </label>
        <label className={styles.field}>
          <span className="t-label muted">NOVÁ CENA</span>
          <input name="price" type="number" min={0} max={cap ?? 1000} required value={draft} onChange={(e) => setDraft(e.target.value)} className={`${styles.input} code ${over ? styles.inputOver : ''}`} aria-invalid={over > 0} aria-describedby={cap ? `cap-${id}` : undefined} />
          {cap ? (
            <span id={`cap-${id}`} className={`t-small ${over ? styles.over : 'muted'}`} role={over ? 'alert' : undefined}>
              {over ? `Nejvýš ${kc(cap)}, překračujete o ${kc(over)}` : `nejvýš ${kc(cap)}`}
            </span>
          ) : null}
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
          <Button variant="ghost" onClick={() => setOpened(null)}>{inNow ? 'Zpět' : 'Zrušit'}</Button>
          <Button type="submit" disabled={pending || price === shipping || over > 0}>{lower ? 'Snížit dopravu' : 'Poslat kupujícímu'}</Button>
        </span>
      </div>
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <p className="t-small muted">
        {lower ? 'Nižší cena platí hned, kupující ji nemusí schvalovat.' : 'Vyšší cenu musí kupující potvrdit. Do té doby nevidí QR kód a může objednávku zrušit bez následků.'}
      </p>
    </form>
  );
}
