'use client';

import { useState } from 'react';
import styles from './auth.module.css';

interface Props {
  name?: string;
  label?: string;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
}

/** Pole pro heslo s tlačítkem Zobrazit (místo druhého opakování hesla). */
export function PasswordField({ name = 'password', label = 'HESLO', autoComplete, hint }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <label className={styles.field}>
      <span className="t-label muted">{label}</span>
      <span className={styles.passwordWrap}>
        <input
          type={visible ? 'text' : 'password'}
          name={name}
          required
          autoComplete={autoComplete}
          minLength={autoComplete === 'new-password' ? 8 : undefined}
          maxLength={72}
          className={styles.input}
        />
        <button type="button" className={styles.reveal} onClick={() => setVisible((v) => !v)} aria-pressed={visible}>
          {visible ? 'Skrýt' : 'Zobrazit'}
        </button>
      </span>
      {hint ? <span className="t-small muted">{hint}</span> : null}
    </label>
  );
}
