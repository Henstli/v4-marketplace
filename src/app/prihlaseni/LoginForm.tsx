'use client';

import { useActionState } from 'react';
import { Button } from '@/components/trezor';
import { sendLoginLink, type LoginState } from './actions';
import styles from './login.module.css';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendLoginLink, {});

  if (state.sentTo) {
    return (
      <div className={styles.sent}>
        <h2 className="t-heading-m">Zkontrolujte e-mail</h2>
        <p className="muted">Na {state.sentTo} jsme poslali odkaz pro přihlášení. Platí hodinu.</p>
      </div>
    );
  }

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="dalsi" value={next} />
      <label className={styles.field}>
        <span className="t-label muted">E-MAIL</span>
        <input type="email" name="email" required autoComplete="email" placeholder="vas@email.cz" className={styles.input} />
      </label>
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>{pending ? 'Odesílám…' : 'Poslat přihlašovací odkaz'}</Button>
      <p className="t-small muted">Heslo nepotřebujete. Pokud účet ještě nemáte, založíme ho.</p>
    </form>
  );
}
