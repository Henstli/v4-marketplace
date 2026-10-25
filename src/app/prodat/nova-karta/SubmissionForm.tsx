'use client';

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import { createClient } from '@/lib/supabase/browser';
import { submitCard, type SubmissionState } from './actions';
import styles from '../sell.module.css';

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024;

export function SubmissionForm({ userId }: { userId: string }) {
  const [state, setState] = useState<SubmissionState>({});
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get('image');
    if (!(file instanceof File) || !file.size) return setState({ error: 'Přiložte prosím fotku karty.' });
    if (!TYPES[file.type]) return setState({ error: 'Fotka musí být JPG, PNG nebo WebP.' });
    if (file.size > MAX_BYTES) return setState({ error: 'Fotka může mít nejvýš 5 MB.' });

    startTransition(async () => {
      const path = `${userId}/${crypto.randomUUID()}.${TYPES[file.type]}`;
      const { error } = await createClient().storage.from('card-submissions').upload(path, file, { contentType: file.type });
      if (error) return setState({ error: 'Fotku se nepodařilo nahrát. Zkuste to prosím znovu.' });
      form.delete('image');
      form.set('image_path', path);
      const result = await submitCard(form);
      setState(result);
      if (result.ok) formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className={styles.form}>
      <label className={styles.field}>
        <span className="t-label muted">HRÁČ</span>
        <input name="player" required minLength={2} maxLength={80} placeholder="např. David Pastrňák" className={styles.input} />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">SEZÓNA</span>
        <input name="season" required minLength={4} maxLength={20} placeholder="např. 2014-15" className={styles.input} />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">VÝROBCE</span>
        <input name="manufacturer" required minLength={2} maxLength={40} placeholder="např. Upper Deck" className={styles.input} />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">SADA</span>
        <input name="set_name" required minLength={2} maxLength={80} placeholder="např. Series 2" className={styles.input} />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">ČÍSLO KARTY</span>
        <input name="number" required maxLength={20} placeholder="např. 462" className={styles.input} />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">VARIANTA (NEPOVINNÉ)</span>
        <input name="variant" maxLength={60} placeholder="např. Young Guns, Exclusives /100" className={styles.input} />
      </label>
      <label className={`${styles.field} ${styles.wide}`}>
        <span className="t-label muted">FOTKA PŘEDNÍ STRANY (JPG, PNG, WEBP, MAX. 5 MB)</span>
        <input name="image" type="file" required accept="image/jpeg,image/png,image/webp" className={styles.file} />
      </label>
      <label className={`${styles.field} ${styles.wide}`}>
        <span className="t-label muted">POZNÁMKA PRO SCHVALOVÁNÍ (NEPOVINNÁ)</span>
        <input name="note" maxLength={300} placeholder="např. odkaz na checklist sady" className={styles.input} />
      </label>
      <div className={`${styles.wide} ${styles.submit}`}>
        <Button type="submit" size="lg" disabled={pending}>{pending ? 'Odesílám…' : 'Odeslat ke schválení'}</Button>
        {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
        {state.ok ? <p className={styles.ok} role="status">Díky, návrh jsme přijali. Po schválení ho najdete v katalogu.</p> : null}
      </div>
    </form>
  );
}
