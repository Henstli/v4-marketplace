'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Button } from '@/components/trezor';
import { CONDITION_NAMES, CONDITIONS, LANGUAGE_NAMES, type Language } from '@/lib/types';
import { createListing, type ListingState } from './actions';
import styles from './sell.module.css';

export function ListingForm({ cardId }: { cardId: string }) {
  const [state, action, pending] = useActionState<ListingState, FormData>(createListing, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className={styles.form}>
      <input type="hidden" name="card" value={cardId} />
      <label className={styles.field}>
        <span className="t-label muted">STAV</span>
        <select name="condition" required defaultValue="NM" className={styles.input}>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c} · {CONDITION_NAMES[c]}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span className="t-label muted">JAZYK</span>
        <select name="language" required defaultValue="en" className={styles.input}>
          {(Object.keys(LANGUAGE_NAMES) as Language[]).map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span className="t-label muted">CENA ZA KUS (KČ)</span>
        <input name="price" type="number" min={1} step={1} required inputMode="numeric" className={styles.input} />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">POČET KUSŮ</span>
        <input name="quantity" type="number" min={1} max={999} step={1} defaultValue={1} required className={styles.input} />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">GRADING (NEPOVINNÉ)</span>
        <input name="graded" placeholder="např. PSA 9" maxLength={20} className={styles.input} />
      </label>
      <label className={`${styles.field} ${styles.wide}`}>
        <span className="t-label muted">POZNÁMKA (NEPOVINNÁ)</span>
        <input name="note" placeholder="např. drobné odření rohu" maxLength={200} className={styles.input} />
      </label>
      <div className={`${styles.wide} ${styles.submit}`}>
        <Button type="submit" size="lg" disabled={pending}>{pending ? 'Ukládám…' : 'Vystavit kartu'}</Button>
        {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
        {state.ok ? <p className={styles.ok} role="status">Karta je vystavená.</p> : null}
      </div>
    </form>
  );
}
