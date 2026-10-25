'use client';

import { useActionState } from 'react';
import { Button } from '@/components/trezor';
import { IdentityCheck } from '@/components/auth/IdentityCheck';
import { PasswordField } from '@/components/auth/PasswordField';
import styles from '@/components/auth/auth.module.css';
import type { IdentityMethod } from '@/lib/identity';
import { setNewPassword, type NewPasswordState } from './actions';

export function NewPasswordForm({ email, check }: { email: string; check: IdentityMethod | null }) {
  const [state, action, pending] = useActionState<NewPasswordState, FormData>(setNewPassword, {});
  return (
    <form action={action} className={styles.form}>
      {/* Správce hesel podle toho pozná, ke kterému účtu heslo uložit. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      {check ? <IdentityCheck method={check} email={email} /> : null}
      <PasswordField label="NOVÉ HESLO" autoComplete="new-password" hint="Aspoň 8 znaků." />
      <PasswordField name="passwordConfirm" label="NOVÉ HESLO ZNOVU" autoComplete="new-password" />
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>{pending ? 'Ukládám…' : 'Uložit heslo'}</Button>
    </form>
  );
}
