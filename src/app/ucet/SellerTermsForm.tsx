'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/trezor';
import { updateSellerTerms, type ProfileState } from './actions';
import styles from '../prodat/sell.module.css';

export interface SellerTerms {
  shipping_czk: number;
  free_shipping_from: number | null;
  pickup: boolean;
  pickup_place: string | null;
  /** Účet k zobrazení (IBAN nebo české číslo účtu), prázdné když ho prodejce nevyplnil */
  account: string;
  account_name: string;
}

export function SellerTermsForm({ terms }: { terms: SellerTerms }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateSellerTerms, {});
  const [pickup, setPickup] = useState(terms.pickup);
  return (
    <form action={action} className={styles.form}>
      <label className={styles.field}>
        <span className="t-label muted">DOPRAVA ZA ZÁSILKU (KČ)</span>
        <input name="shipping" type="number" min={0} max={1000} step={1} required defaultValue={terms.shipping_czk} className={styles.input} />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">DOPRAVA ZDARMA OD (KČ, NEPOVINNÉ)</span>
        <input name="freeFrom" type="number" min={1} max={100000} step={1} defaultValue={terms.free_shipping_from ?? ''} className={styles.input} placeholder="např. 1000" />
      </label>
      <label className={`${styles.field} ${styles.wide}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <input name="pickup" type="checkbox" checked={pickup} onChange={(e) => setPickup(e.target.checked)} />
        <span>Nabízím osobní předání zdarma</span>
      </label>
      {pickup ? (
        <label className={`${styles.field} ${styles.wide}`}>
          <span className="t-label muted">KDE PŘEDÁVÁTE</span>
          <input name="pickupPlace" maxLength={60} required defaultValue={terms.pickup_place ?? ''} className={styles.input} placeholder="např. Praha 4, Brno-střed" />
        </label>
      ) : null}
      <label className={styles.field}>
        <span className="t-label muted">ČÍSLO ÚČTU NEBO IBAN</span>
        <input name="account" defaultValue={terms.account} className={styles.input} placeholder="123456789/0800" autoComplete="off" />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">MAJITEL ÚČTU</span>
        <input name="accountName" maxLength={70} defaultValue={terms.account_name} className={styles.input} />
      </label>
      <p className={`t-small muted ${styles.wide}`}>
        Účet uvidí jen kupující, jehož objednávku potvrdíte, spolu s QR platbou a variabilním symbolem. Platba jde přímo
        vám, V4cards peníze nepřijímá.
      </p>
      <div className={`${styles.wide} ${styles.submit}`}>
        <Button type="submit" disabled={pending}>{pending ? 'Ukládám…' : 'Uložit dopravu a platbu'}</Button>
        {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
        {state.ok ? <p className={styles.ok} role="status">Uloženo.</p> : null}
      </div>
    </form>
  );
}
