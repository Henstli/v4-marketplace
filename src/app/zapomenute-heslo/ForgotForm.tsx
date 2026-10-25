'use client';

import { useActionState } from 'react';
import { Button } from '@/components/trezor';
import { EmailField } from '@/components/auth/EmailField';
import styles from '@/components/auth/auth.module.css';
import { sendResetLink, type ForgotState } from './actions';

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(sendResetLink, {});

  if (state.sentTo) {
    return (
      <div className={styles.sent}>
        <h2 className="t-heading-m">Zkontrolujte e-mail</h2>
        <p className="muted">
          Pokud u nás má {state.sentTo} účet, poslali jsme na něj odkaz pro nastavení nového hesla. Otevřete ho ve stejném
          prohlížeči.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className={styles.form}>
      <EmailField />
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>{pending ? 'Odesílám…' : 'Poslat odkaz pro nové heslo'}</Button>
    </form>
  );
}
