'use client';

import { useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/trezor';
import { orderPaidMethods, setOrderStatus } from '@/app/objednavky/actions';
import { PAID_VIA, type PaidVia } from '@/lib/order-flow';
import styles from './prepay.module.css';

function Submit({ className, disabled }: { className?: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={disabled || pending} className={className}>{pending ? 'Ukládám…' : 'Potvrdit'}</Button>;
}

/**
 * „Zaplaceno“ (DS OrderPayment › Jak jste zaplatili): má-li prodejce víc způsobů předem,
 * kupující vybere, kudy platil, aby prodejce věděl, kde platbu hledat. S jedním způsobem se odešle hned.
 */
export function PaidButton({ id, label, className, buttonClassName }: { id: string; label: string; className?: string; buttonClassName?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const viaInput = useRef<HTMLInputElement>(null);
  const [methods, setMethods] = useState<PaidVia[] | null>(null);
  const [via, setVia] = useState<PaidVia | ''>('');
  const [loading, startLoading] = useTransition();

  const start = () =>
    startLoading(async () => {
      const list = await orderPaidMethods(id).catch(() => [] as PaidVia[]);
      if (list.length > 1) {
        setMethods(list);
        return;
      }
      // Jediný způsob: rovnou odeslat.
      setVia(list[0] ?? '');
      if (viaInput.current) viaInput.current.value = list[0] ?? '';
      form.current?.requestSubmit();
    });

  const open = !!methods;
  return (
    <form ref={form} action={setOrderStatus} className={`${className ?? ''} ${open ? styles.paidOpen : ''}`}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value="mark_paid" />
      <input ref={viaInput} type="hidden" name="via" value={via} />
      {open ? (
        <div className={styles.paid}>
          <span className="t-label muted">JAK JSTE ZAPLATILI?</span>
          <div className={styles.tabs} role="radiogroup" aria-label="Jak jste zaplatili">
            {methods.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={via === m} aria-selected={via === m} className={styles.tab} onClick={() => setVia(m)}>{PAID_VIA[m].name}</button>
            ))}
          </div>
          <p className="t-small muted">Prodejce tak bude vědět, kde platbu hledat.</p>
          <div className={styles.paidButtons}>
            <Button variant="ghost" className={buttonClassName} onClick={() => { setMethods(null); setVia(''); }}>Zpět</Button>
            <Submit className={buttonClassName} disabled={!via} />
          </div>
        </div>
      ) : (
        <Button className={buttonClassName} disabled={loading} onClick={start}>{loading ? 'Načítám…' : label}</Button>
      )}
    </form>
  );
}
