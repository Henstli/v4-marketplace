'use client';

import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/trezor';
import { reportStep, type ReportState } from '@/app/ucet/hlaseni-actions';
import styles from './reports.module.css';

function Submit({ label, variant, full }: { label: string; variant?: 'primary' | 'secondary' | 'ghost'; full?: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} disabled={pending} className={full ? styles.full : undefined}>{pending ? 'Ukládám…' : label}</Button>;
}

/** Jeden krok hlášení jako formulář s chybou pod ním. `children` = pole formuláře. */
export function Step({ id, op, label, variant = 'primary', full = true, children, className }: {
  id: string; op: string; label: string; variant?: 'primary' | 'secondary' | 'ghost'; full?: boolean; children?: ReactNode; className?: string;
}) {
  const [state, action] = useActionState<ReportState, FormData>(reportStep, {});
  return (
    <form action={action} className={className ?? styles.form}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      {children}
      <Submit label={label} variant={variant} full={full} />
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
    </form>
  );
}
