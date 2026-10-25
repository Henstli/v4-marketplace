'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import styles from '@/components/auth/auth.module.css';
import { confirmMfa, disableMfa, startMfa, type MfaState } from './actions';

/** Zapnutí a vypnutí dvoufázového ověření přes ověřovací aplikaci (TOTP). */
export function MfaSettings({ enabled }: { enabled: boolean }) {
  const [isOn, setIsOn] = useState(enabled);
  const [step, setStep] = useState<MfaState>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [verify, verifyAction, verifying] = useActionState<MfaState, FormData>(async (prev, form) => {
    const result = await confirmMfa(prev, form);
    if (result.done === 'enabled') {
      setIsOn(true);
      setStep({});
      setNotice('Dvoufázové ověření je zapnuté.');
    }
    return result;
  }, {});

  if (isOn) {
    return (
      <div className={styles.form}>
        {notice ? <p className={styles.ok} role="status">{notice}</p> : null}
        <p>Zapnuto. Při přihlášení zadáte heslo a pak kód z ověřovací aplikace.</p>
        {step.error ? <p className={styles.error} role="alert">{step.error}</p> : null}
        <div>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              if (!window.confirm('Opravdu vypnout dvoufázové ověření? Účet pak bude chráněný jen heslem.')) return;
              startTransition(async () => {
                const result = await disableMfa();
                if (result.done === 'disabled') {
                  setIsOn(false);
                  setStep({});
                  setNotice('Dvoufázové ověření je vypnuté.');
                } else setStep(result);
              });
            }}
          >
            {pending ? 'Vypínám…' : 'Vypnout'}
          </Button>
        </div>
      </div>
    );
  }

  if (!step.enroll) {
    return (
      <div className={styles.form}>
        {notice ? <p className={styles.ok} role="status">{notice}</p> : null}
        <p className="muted">
          Kromě hesla budete při přihlášení zadávat kód z aplikace v telefonu (Google Authenticator, Microsoft Authenticator,
          1Password a podobně). Ani s ukradeným heslem se pak nikdo do účtu nedostane.
        </p>
        {step.error ? <p className={styles.error} role="alert">{step.error}</p> : null}
        <div>
          <Button disabled={pending} onClick={() => startTransition(async () => setStep(await startMfa()))}>
            {pending ? 'Připravuji…' : 'Zapnout dvoufázové ověření'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={verifyAction} className={styles.form}>
      <input type="hidden" name="factorId" value={step.enroll.factorId} />
      <p>1. V ověřovací aplikaci přidejte účet naskenováním QR kódu.</p>
      <img src={step.enroll.qr} alt="QR kód pro ověřovací aplikaci" className={styles.qr} />
      <p className="t-small muted">
        Nejde naskenovat? Zadejte do aplikace klíč ručně: <span className={styles.secret}>{step.enroll.secret}</span>
      </p>
      <label className={styles.field}>
        <span className="t-label muted">2. OPIŠTE KÓD Z APLIKACE</span>
        <input
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123 456"
          className={`${styles.input} ${styles.code}`}
        />
      </label>
      {verify.error ? <p className={styles.error} role="alert">{verify.error}</p> : null}
      <div>
        <Button type="submit" disabled={verifying}>{verifying ? 'Ověřuji…' : 'Dokončit zapnutí'}</Button>
      </div>
    </form>
  );
}
