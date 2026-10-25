'use client';

import { useActionState } from 'react';
import { Button } from '@/components/trezor';
import { PasswordField } from '@/components/auth/PasswordField';
import styles from '@/components/auth/auth.module.css';
import { setNewPassword, type NewPasswordState } from './actions';

export function NewPasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<NewPasswordState, FormData>(setNewPassword, {});
  return (
    <form action={action} className={styles.form}>
      {/* Správce hesel podle toho pozná, ke kterému účtu heslo uložit. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <PasswordField label="NOVÉ HESLO" autoComplete="new-password" hint="Aspoň 8 znaků." />
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>{pending ? 'Ukládám…' : 'Uložit heslo'}</Button>
    </form>
  );
}
