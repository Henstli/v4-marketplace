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
  const [disabling, setDisabling] = useState(false);
  const [disable, disableAction, turningOff] = useActionState<MfaState, FormData>(async (prev, form) => {
    const result = await disableMfa(prev, form);
    if (result.done === 'disabled') {
      setIsOn(false);
      setDisabling(false);
      setStep({});
      setNotice('Dvoufázové ověření je vypnuté.');
    }
    return result;
  }, {});

  if (isOn) {
    return (
      <div className={styles.form}>
        {notice ? <p className={styles.ok} role="status">{notice}</p> : null}
        <p>Zapnuto. Při přihlášení zadáte heslo a pak kód z ověřovací aplikace.</p>
        {disabling ? (
          <form action={disableAction} className={styles.form}>
            <label className={styles.field}>
              <span className="t-label muted">PRO VYPNUTÍ ZADEJTE KÓD Z APLIKACE</span>
              <input
                name="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                autoFocus
                className={`${styles.input} ${styles.code}`}
              />
              <span className="t-small muted">Bez dvoufázového ověření bude účet chráněný jen heslem.</span>
            </label>
            {disable.error ? <p className={styles.error} role="alert">{disable.error}</p> : null}
            <div className={styles.row}>
              <Button type="submit" variant="secondary" disabled={turningOff}>{turningOff ? 'Vypínám…' : 'Vypnout'}</Button>
              <Button variant="ghost" onClick={() => setDisabling(false)}>Zrušit</Button>
            </div>
          </form>
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setDisabling(true)}>Vypnout</Button>
          </div>
        )}
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
      <p>1. Nainstalujte si do telefonu ověřovací aplikaci, pokud ji ještě nemáte. Stačí kterákoli z těchto (všechny jsou zdarma):</p>
      <ul className="t-small" style={{ margin: 0, paddingLeft: 'var(--space-6)' }}>
        <li>Google Authenticator (<a href="https://apps.apple.com/app/google-authenticator/id388497605" target="_blank" rel="noreferrer">iPhone</a>, <a href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2" target="_blank" rel="noreferrer">Android</a>)</li>
        <li>Microsoft Authenticator (<a href="https://apps.apple.com/app/microsoft-authenticator/id983156458" target="_blank" rel="noreferrer">iPhone</a>, <a href="https://play.google.com/store/apps/details?id=com.azure.authenticator" target="_blank" rel="noreferrer">Android</a>)</li>
        <li>nebo správce hesel s kódy (1Password, Bitwarden, Hesla v iPhonu)</li>
      </ul>
      <p>2. V aplikaci zvolte Přidat účet a naskenujte QR kód.</p>
      <img src={step.enroll.qr} alt="QR kód pro ověřovací aplikaci" className={styles.qr} />
      <p className="t-small muted">
        Zakládáte to přímo v telefonu, nebo nejde naskenovat? Zadejte v aplikaci klíč ručně: <span className={styles.secret}>{step.enroll.secret}</span>
      </p>
      <label className={styles.field}>
        <span className="t-label muted">3. OPIŠTE KÓD Z APLIKACE</span>
        <input
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          className={`${styles.input} ${styles.code}`}
        />
        <span className="t-small muted">Šest číslic, které vám teď ukazuje aplikace. Mění se každých 30 sekund.</span>
      </label>
      {verify.error ? <p className={styles.error} role="alert">{verify.error}</p> : null}
      <div>
        <Button type="submit" disabled={verifying}>{verifying ? 'Ověřuji…' : 'Dokončit zapnutí'}</Button>
      </div>
    </form>
  );
}
