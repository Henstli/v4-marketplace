'use client';

import { useActionState } from 'react';
import { keepForm } from '@/lib/form';
import { Button } from '@/components/trezor';
import { updateProfile, type ProfileState } from './actions';
import styles from '../prodat/sell.module.css';

export function ProfileForm({ profile }: { profile: { display_name: string; kind: string; country: string } }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateProfile, {});
  return (
    <form onSubmit={keepForm(action)} className={styles.form}>
      <label className={styles.field}>
        <span className="t-label muted">JMÉNO NEBO NÁZEV OBCHODU</span>
        <input name="displayName" defaultValue={profile.display_name} required minLength={2} maxLength={40} className={styles.input} />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">PRODÁVÁM JAKO</span>
        <select name="kind" defaultValue={profile.kind} className={styles.input}>
          <option value="private">Sběratel</option>
          <option value="shop">Obchod</option>
        </select>
      </label>
      <label className={styles.field}>
        <span className="t-label muted">ZEMĚ</span>
        <select name="country" defaultValue={profile.country} className={styles.input}>
          <option value="CZ">Česko</option>
          <option value="SK">Slovensko</option>
        </select>
      </label>
      <div className={`${styles.wide} ${styles.submit}`}>
        <Button type="submit" disabled={pending}>{pending ? 'Ukládám…' : 'Uložit profil'}</Button>
        {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
        {state.ok ? <p className={styles.ok} role="status">Uloženo.</p> : null}
      </div>
    </form>
  );
}
