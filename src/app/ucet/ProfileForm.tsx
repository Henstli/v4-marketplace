'use client';

import { useActionState, useState } from 'react';
import { keepForm } from '@/lib/form';
import { Button } from '@/components/trezor';
import { updateProfile, type ProfileState } from './actions';
import styles from '../prodat/sell.module.css';

/**
 * Profil prodejce. Obchod = podnikatel s IČO, Sběratel = soukromý prodejce s prohlášením (DS Reports › Typ prodejce):
 * podle toho web kupujícím říká, jestli se na nákup vztahují práva spotřebitele.
 */
export function ProfileForm({ profile }: { profile: { display_name: string; kind: string; country: string; ico?: string | null; private_declared_at?: string | null } }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateProfile, {});
  const [kind, setKind] = useState(profile.kind);
  return (
    <form onSubmit={keepForm(action)} className={styles.form}>
      <label className={styles.field}>
        <span className="t-label muted">JMÉNO NEBO NÁZEV OBCHODU</span>
        <input name="displayName" defaultValue={profile.display_name} required minLength={2} maxLength={40} className={styles.input} />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">PRODÁVÁM JAKO</span>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={styles.input}>
          <option value="private">Sběratel (soukromá osoba)</option>
          <option value="shop">Obchod (podnikatel s IČO)</option>
        </select>
      </label>
      <label className={styles.field}>
        <span className="t-label muted">ZEMĚ</span>
        <select name="country" defaultValue={profile.country} className={styles.input}>
          <option value="CZ">Česko</option>
          <option value="SK">Slovensko</option>
        </select>
      </label>
      {kind === 'shop' ? (
        <label className={styles.field}>
          <span className="t-label muted">IČO</span>
          <input name="ico" defaultValue={profile.ico ?? ''} required inputMode="numeric" pattern="[0-9]{8}" maxLength={8} className={`${styles.input} code`} />
          <span className="t-small muted">U nabídek se ukáže štítek Obchod. Jako podnikatel odpovídáte kupujícím podle zákona o ochraně spotřebitele (reklamace, vrácení do 14 dnů).</span>
        </label>
      ) : (
        <label className={`${styles.wide}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <input type="checkbox" name="privateDeclared" defaultChecked={!!profile.private_declared_at} required style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
          <span className="t-small">Neprodávám jako podnikatel, prodávám ze své sbírky. Kupující u mých nabídek uvidí „Soukromý prodejce · práva spotřebitele se na nákup nevztahují“.</span>
        </label>
      )}
      <div className={`${styles.wide} ${styles.submit}`}>
        <Button type="submit" disabled={pending}>{pending ? 'Ukládám…' : 'Uložit profil'}</Button>
        {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
        {state.ok ? <p className={styles.ok} role="status">Uloženo.</p> : null}
      </div>
    </form>
  );
}
