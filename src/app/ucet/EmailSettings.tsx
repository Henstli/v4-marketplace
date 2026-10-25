'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/trezor';
import { IdentityCheck } from '@/components/auth/IdentityCheck';
import styles from '@/components/auth/auth.module.css';
import type { IdentityMethod } from '@/lib/identity';
import { changeEmail, type EmailChangeState } from './actions';

/** Změna přihlašovacího e-mailu. */
export function EmailSettings({ email, method }: { email: string; method: IdentityMethod }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<EmailChangeState, FormData>(changeEmail, {});

  if (state.sentTo) {
    return (
      <p className={styles.ok} role="status">
        Na {state.sentTo} jsme poslali odkaz pro potvrzení. Pro jistotu přijde potvrzovací odkaz i na {email}. Změna se
        projeví, až kliknete na oba.
      </p>
    );
  }
  if (!open) {
    return (
      <div className={styles.row}>
        <span>{email}</span>
        <Button variant="secondary" onClick={() => setOpen(true)}>Změnit e-mail</Button>
      </div>
    );
  }
  return (
    <form action={action} className={styles.form}>
      <label className={styles.field}>
        <span className="t-label muted">NOVÝ E-MAIL</span>
        <input type="email" name="newEmail" required autoComplete="email" className={styles.input} />
      </label>
      <IdentityCheck method={method} email={email} />
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <div className={styles.row}>
        <Button type="submit" disabled={pending}>{pending ? 'Odesílám…' : 'Změnit e-mail'}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Zrušit</Button>
      </div>
    </form>
  );
}
