'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/trezor';
import { EmailField } from '@/components/auth/EmailField';
import { PasswordField } from '@/components/auth/PasswordField';
import styles from '@/components/auth/auth.module.css';
import { signUp, type SignupState } from './actions';

export function SignupForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUp, {});

  if (state.sentTo) {
    return (
      <div className={styles.sent}>
        <h2 className="t-heading-m">Ověřte e-mail</h2>
        <p className="muted">
          Na {state.sentTo} jsme poslali odkaz pro dokončení registrace. Po kliknutí na něj budete přihlášeni.
        </p>
        <p className="t-small muted">
          Nic nepřišlo? Zkontrolujte spam. Pokud už u nás účet máte, <Link href="/prihlaseni">přihlaste se</Link> nebo si{' '}
          <Link href="/zapomenute-heslo">obnovte heslo</Link>.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="dalsi" value={next} />
      <label className={styles.field}>
        <span className="t-label muted">PŘEZDÍVKA</span>
        <input name="displayName" required minLength={2} maxLength={40} autoComplete="nickname" placeholder="Jak vás uvidí ostatní" className={styles.input} />
      </label>
      <EmailField />
      <PasswordField autoComplete="new-password" hint="Aspoň 8 znaků. Nejbezpečnější je delší fráze nebo heslo ze správce hesel." />
      <PasswordField name="passwordConfirm" label="HESLO ZNOVU" autoComplete="new-password" />
      <label className="t-small" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
        <input type="checkbox" name="terms" required />
        <span>
          Souhlasím s{' '}
          <Link href="/obchodni-podminky" target="_blank">obchodními podmínkami</Link> a beru na vědomí{' '}
          <Link href="/ochrana-osobnich-udaju" target="_blank">zásady ochrany osobních údajů</Link>.
        </span>
      </label>
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>{pending ? 'Zakládám účet…' : 'Vytvořit účet'}</Button>
    </form>
  );
}
