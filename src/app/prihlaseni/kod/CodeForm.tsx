'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import styles from '@/components/auth/auth.module.css';
import { resendLoginCode, verifyLoginCode, type LoginCodeState } from './actions';

export function CodeForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginCodeState, FormData>(verifyLoginCode, {});
  const [resend, setResend] = useState<LoginCodeState>({});
  const [resending, startResend] = useTransition();
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="dalsi" value={next} />
      <label className={styles.field}>
        <span className="t-label muted">KÓD Z E-MAILU</span>
        <input
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,11}"
          maxLength={11}
          autoFocus
          className={`${styles.input} ${styles.code}`}
        />
      </label>
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      {resend.error ? <p className={styles.error} role="alert">{resend.error}</p> : null}
      {resend.resent ? <p className={styles.ok} role="status">Nový kód je na cestě.</p> : null}
      <Button type="submit" size="lg" disabled={pending}>{pending ? 'Ověřuji…' : 'Přihlásit se'}</Button>
      <Button variant="ghost" disabled={resending} onClick={() => startResend(async () => setResend(await resendLoginCode()))}>
        {resending ? 'Odesílám…' : 'Poslat kód znovu'}
      </Button>
    </form>
  );
}
