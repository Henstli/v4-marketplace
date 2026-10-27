'use client';

import { useState } from 'react';
import { addressProblem, type DeliveryAddress } from '@/lib/delivery';
import styles from './cart.module.css';

/**
 * Příjemce zásilky (DS DeliveryPayment › Doručení na adresu). U výdejního místa jen jméno a telefon,
 * u doručení na adresu celá adresa. Uložená adresa se ukáže jako karta se Změnit.
 */
export function AddressBlock({ kind, value, onChange, saved, save, onSave, phoneOptional, shared }: {
  kind: 'point' | 'home';
  value: DeliveryAddress;
  onChange: (a: DeliveryAddress) => void;
  saved: boolean;
  save: boolean;
  onSave: (on: boolean) => void;
  phoneOptional: boolean;
  shared: boolean;
}) {
  const complete = !addressProblem(kind, value, phoneOptional);
  const [editing, setEditing] = useState(!saved || !complete);
  const set = (k: keyof DeliveryAddress) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });

  if (!editing && complete) {
    return (
      <div className={styles.addrBlock}>
        <span className={styles.addrLabel}>{kind === 'home' ? 'DORUČIT NA ADRESU' : 'PŘÍJEMCE'}</span>
        <div className={styles.picked}>
          <span className={styles.pickedText}>
            <strong>{value.name}</strong>
            {kind === 'home' ? <small>{value.street}, {value.zip.replace(/\s/g, '').replace(/^(\d{3})(\d{2})$/, '$1 $2')} {value.city}, {value.country === 'SK' ? 'Slovensko' : 'Česko'}</small> : null}
            {value.phone ? <small className="code">{value.phone}</small> : null}
          </span>
          <button type="button" className={styles.pickedChange} onClick={() => setEditing(true)}>Změnit</button>
        </div>
        {shared ? <small className={styles.addrHint}>Platí pro všechny prodejce v košíku.</small> : null}
      </div>
    );
  }

  return (
    <div className={styles.addrBlock}>
      <span className={styles.addrLabel}>{kind === 'home' ? 'DORUČIT NA ADRESU' : 'PŘÍJEMCE'}</span>
      <label className={styles.point}>
        Jméno a příjmení
        <input value={value.name} onChange={set('name')} maxLength={80} autoComplete="name" />
      </label>
      {kind === 'home' ? (
        <>
          <label className={styles.point}>
            Ulice a číslo
            <input value={value.street} onChange={set('street')} maxLength={120} autoComplete="street-address" />
          </label>
          <div className={styles.addrRow}>
            <label className={styles.point}>
              Město
              <input value={value.city} onChange={set('city')} maxLength={80} autoComplete="address-level2" />
            </label>
            <label className={`${styles.point} ${styles.addrZip}`}>
              PSČ
              <input value={value.zip} onChange={set('zip')} maxLength={6} inputMode="numeric" autoComplete="postal-code" className="code" />
            </label>
          </div>
        </>
      ) : null}
      <div className={styles.addrRow}>
        {kind === 'home' ? (
          <label className={`${styles.point} ${styles.addrCountry}`}>
            Země
            <select value={value.country} onChange={set('country')} autoComplete="country">
              <option value="CZ">Česko</option>
              <option value="SK">Slovensko</option>
            </select>
          </label>
        ) : null}
        <label className={styles.point}>
          Telefon{phoneOptional ? ' (nepovinný)' : ''}
          <input value={value.phone} onChange={set('phone')} maxLength={20} inputMode="tel" autoComplete="tel" className="code" placeholder="+420 777 123 456" />
          <small className={styles.addrHint}>{kind === 'point' ? 'Na něj přijde zpráva, že je zásilka na místě.' : 'Dopravce pošle zprávu o doručení.'}</small>
        </label>
      </div>
      <label className={styles.addrSave}>
        <input type="checkbox" checked={save} onChange={(e) => onSave(e.target.checked)} />
        <span>
          Uložit {kind === 'home' ? 'adresu' : 'jméno a telefon'} pro příští nákupy
          <small>Uvidíte je jen vy, smazat je můžete v Můj profil › Nastavení.</small>
        </span>
      </label>
      {shared ? <small className={styles.addrHint}>Platí pro všechny prodejce v košíku.</small> : null}
    </div>
  );
}
