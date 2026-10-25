'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/trezor';
import { EmailField } from '@/components/auth/EmailField';
import { PasswordField } from '@/components/auth/PasswordField';
import styles from '@/components/auth/auth.module.css';
import { resendConfirmation, signInWithPassword, type LoginState } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInWithPassword, {});
  const [resend, resendAction, resending] = useActionState<LoginState, FormData>(resendConfirmation, {});

  return (
    <>
      <form action={action} className={styles.form}>
        <input type="hidden" name="dalsi" value={next} />
        <EmailField />
        <PasswordField autoComplete="current-password" />
        <div className={styles.row}>
          <span />
          <Link href="/zapomenute-heslo" className="t-small">Zapomenuté heslo?</Link>
        </div>
        {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
        <Button type="submit" size="lg" disabled={pending}>{pending ? 'Přihlašuji…' : 'Přihlásit se'}</Button>
      </form>
      {state.unconfirmed ? (
        <form action={resendAction} className={styles.form}>
          <input type="hidden" name="email" value={state.unconfirmed} />
          <input type="hidden" name="dalsi" value={next} />
          {resend.resent ? (
            <p className={styles.ok} role="status">Nový ověřovací odkaz jsme poslali na {state.unconfirmed}.</p>
          ) : (
            <Button type="submit" variant="secondary" disabled={resending}>{resending ? 'Odesílám…' : 'Poslat ověřovací odkaz znovu'}</Button>
          )}
          {resend.error ? <p className={styles.error} role="alert">{resend.error}</p> : null}
        </form>
      ) : null}
    </>
  );
}
