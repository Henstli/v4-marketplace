'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/trezor';
import { userAuthMail, userMfaReset, userPlan, userProfile, userSignout, userVerify } from '@/app/sprava/podpora/actions';
import styles from '@/app/sprava/podpora/podpora.module.css';

interface Props {
  userId: string;
  fullAdmin: boolean;
  plan: string;
  verified: string | null;
  name: string;
  kind: 'private' | 'shop';
  ico: string | null;
  mfa: boolean;
  confirmed: boolean;
}

type Row = 'plan' | 'verify' | 'profile' | 'security' | 'mail';

/** Karta AKCE S ÚČTEM: řádky, po kliknutí se pod řádkem rozbalí formulář (DS Support › Uživatel). */
export function AccountActions(p: Props) {
  const [open, setOpen] = useState<Row | null>(null);
  const [verifiedId, setVerifiedId] = useState(false);

  const row = (id: Row, title: string, hint: string, body: ReactNode) => (
    <div className={styles.accRow}>
      <button type="button" className={styles.accHead} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
        <span><strong>{title}</strong><span className={styles.small}>{hint}</span></span>
        <span aria-hidden="true" className={styles.accArrow}>›</span>
      </button>
      {open === id ? <div className={styles.accBody}>{body}</div> : null}
    </div>
  );
  const hidden = <input type="hidden" name="user_id" value={p.userId} />;
  const reason = (ph: string, min = 3) => (
    <input className={styles.input} name="reason" required minLength={min} maxLength={300} placeholder={ph} aria-label="Důvod" />
  );

  return (
    <section className={styles.box} aria-label="Akce s účtem">
      <h2 className={styles.boxTitle}>AKCE S ÚČTEM</h2>
      <div className={styles.accList}>
        {row('plan', 'Předplatné', `Teď ${p.plan === 'pro' ? 'Pro' : p.plan === 'plus' ? 'Plus' : 'Zdarma'}`, (
          <form action={userPlan} className={styles.accForm}>
            {hidden}
            <select className={styles.input} name="plan" defaultValue={p.plan} aria-label="Tarif">
              <option value="free">Zdarma</option>
              <option value="plus">Plus</option>
              <option value="pro">Pro</option>
            </select>
            {reason('Proč, např. zaplatil a nedostal')}
            <Button type="submit">Uložit tarif</Button>
          </form>
        ))}
        {p.fullAdmin ? row('verify', 'Ověření obchodu', p.verified ? (p.verified === 'ico' ? 'Ověřeno podle IČO' : 'Ověřená totožnost') : 'Neověřeno · jen správce', (
          <form action={userVerify} className={styles.accForm}>
            {hidden}
            <select className={styles.input} name="method" defaultValue={p.verified ?? 'ico'} aria-label="Způsob ověření">
              <option value="ico">Podle IČO</option>
              <option value="identity">Totožnost</option>
              <option value="none">Odebrat ověření</option>
            </select>
            <input className={styles.input} name="ico" defaultValue={p.ico ?? ''} placeholder="IČO (u ověření podle IČO)" aria-label="IČO" />
            <Button type="submit">Uložit ověření</Button>
          </form>
        )) : null}
        {row('profile', 'Údaje účtu', 'Přezdívka, typ účtu, IČO', (
          <form action={userProfile} className={styles.accForm}>
            {hidden}
            <input className={styles.input} name="name" defaultValue={p.name} required minLength={2} maxLength={40} aria-label="Přezdívka" />
            <div className={styles.two}>
              <select className={styles.input} name="kind" defaultValue={p.kind} aria-label="Typ účtu">
                <option value="private">Sběratel</option>
                <option value="shop">Obchod</option>
              </select>
              <input className={styles.input} name="ico" defaultValue={p.ico ?? ''} placeholder="IČO" aria-label="IČO" />
            </div>
            {reason('Proč, např. na žádost uživatele')}
            <Button type="submit">Uložit údaje</Button>
          </form>
        ))}
        {row('security', 'Přihlášení a zabezpečení', p.mfa ? 'Dvoufázové ověření zapnuté' : 'Dvoufázové ověření vypnuté', (
          <div className={styles.accForm}>
            <form action={userSignout} className={styles.accForm}>
              {hidden}
              {reason('Proč, např. podezření na cizí přihlášení')}
              <Button type="submit" variant="secondary">Odhlásit ze všech zařízení</Button>
            </form>
            {p.mfa ? (
              <form action={userMfaReset} className={styles.accForm}>
                {hidden}
                {reason('Jak jste ověřili totožnost (aspoň 10 znaků)', 10)}
                <label className={styles.check}>
                  <input type="checkbox" name="verified" checked={verifiedId} onChange={(e) => setVerifiedId(e.target.checked)} /> Totožnost jsem ověřil(a)
                </label>
                <Button type="submit" variant="secondary" disabled={!verifiedId}>Vypnout dvoufázové ověření</Button>
              </form>
            ) : null}
          </div>
        ))}
        {row('mail', 'E-mail', p.confirmed ? 'Odkaz na nové heslo' : 'E-mail zatím nepotvrzený', (
          <form action={userAuthMail} className={styles.accForm}>
            {hidden}
            {reason('Proč, např. uživatel nemá přístup')}
            <div className={styles.row}>
              <Button type="submit" name="kind" value="password" variant="secondary">Poslat odkaz na nové heslo</Button>
              {!p.confirmed ? <Button type="submit" name="kind" value="confirm" variant="secondary">Poslat znovu potvrzení</Button> : null}
            </div>
          </form>
        ))}
      </div>
      <p className={styles.small}>Každá akce se zapíše do Záznamu akcí a do historie uživatele.</p>
    </section>
  );
}
