'use client';

import { useActionState } from 'react';
import { Button } from '@/components/trezor';
import styles from '@/components/auth/auth.module.css';
import { verifyMfa, type VerifyState } from './actions';

export function VerifyForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(verifyMfa, {});
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="dalsi" value={next} />
      <label className={styles.field}>
        <span className="t-label muted">KÓD Z APLIKACE</span>
        <input
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          autoFocus
          className={`${styles.input} ${styles.code}`}
        />
        <span className="t-small muted">Šest číslic, které vám teď ukazuje aplikace. Mění se každých 30 sekund.</span>
      </label>
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>{pending ? 'Ověřuji…' : 'Ověřit'}</Button>
    </form>
  );
}
