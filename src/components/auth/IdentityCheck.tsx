'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import type { IdentityMethod } from '@/lib/identity';
import { sendIdentityCode, type CodeSendState } from '@/lib/identity-actions';
import { PasswordField } from './PasswordField';
import styles from './auth.module.css';

/** Pole pro potvrzení citlivé změny: současné heslo, kód z aplikace, nebo kód z e-mailu. */
export function IdentityCheck({ method, email }: { method: IdentityMethod; email: string }) {
  const [sendState, setSendState] = useState<CodeSendState>({});
  const [sending, startSending] = useTransition();

  if (method === 'password') {
    return <PasswordField name="currentPassword" label="SOUČASNÉ HESLO" autoComplete="current-password" />;
  }

  return (
    <div className={styles.form}>
      {method === 'email' ? (
        <div className={styles.row}>
          <span className="t-small muted">
            {sendState.sent ? `Kód jsme poslali na ${email}.` : `Pro jistotu vám pošleme kód na ${email}.`}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={sending}
            onClick={() => startSending(async () => setSendState(await sendIdentityCode()))}
          >
            {sending ? 'Odesílám…' : sendState.sent ? 'Poslat znovu' : 'Poslat kód'}
          </Button>
        </div>
      ) : null}
      {sendState.error ? <p className={styles.error} role="alert">{sendState.error}</p> : null}
      <label className={styles.field}>
        <span className="t-label muted">{method === 'totp' ? 'KÓD Z OVĚŘOVACÍ APLIKACE' : 'KÓD Z E-MAILU'}</span>
        <input
          name="identityCode"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,11}"
          maxLength={11}
          className={`${styles.input} ${styles.code}`}
        />
      </label>
    </div>
  );
}
