'use client';

import dynamic from 'next/dynamic';
import { useActionState, useState } from 'react';
import { keepForm } from '@/lib/form';
import { Button } from '@/components/trezor';
import { CARRIERS, COD_MARGIN, SHIPPING_PACKING, type Carrier, type CarrierRate, type ShippingMethod } from '@/lib/delivery';
import { updateDeliveryPayment, type ProfileState } from './actions';
import { placeAt, PlaceInput } from './PlaceInput';
import styles from './delivery.module.css';

// Mapa jen v prohlížeči (Leaflet sahá na window).
const PickupMap = dynamic(() => import('./PickupMap').then((m) => m.PickupMap), {
  ssr: false,
  loading: () => <div className={styles.map} aria-hidden />,
});

export interface DeliveryPaymentValues {
  transfer: boolean;
  /** Účet k zobrazení (české číslo nebo IBAN), prázdné když ho prodejce nevyplnil */
  account: string;
  accountName: string;
  /** Jméno PayPal.Me a Revtag, prázdné = vypnuto */
  paypalMe: string;
  revtag: string;
  cashOnPickup: boolean;
  pickup: boolean;
  pickupPlace: string;
  pickupLat: number | null;
  pickupLng: number | null;
  pickupRadius: number;
  /** Přesné místo (obchod, pobočka) místo okruhu */
  pickupExact: boolean;
  freeFrom: number | null;
  methods: ShippingMethod[];
  /** Ceníky dopravců pro strop ceny (prázdné, dokud není migrace shipping_caps). */
  rates: Partial<Record<Carrier, CarrierRate>>;
}

/** Nastavení › Doprava a platba (DS DeliveryPayment). `back`: kam se vrátit po uložení (výzva v Prodat). */
export function DeliveryPaymentForm({ values, back }: { values: DeliveryPaymentValues; back?: string }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateDeliveryPayment, {});
  const [transfer, setTransfer] = useState(values.transfer);
  const [paypal, setPaypal] = useState(!!values.paypalMe);
  const [revolut, setRevolut] = useState(!!values.revtag);
  const [pickup, setPickup] = useState(values.pickup);
  const [cash, setCash] = useState(values.cashOnPickup);
  const [cod, setCod] = useState(values.methods.some((m) => m.cod));
  const [pos, setPos] = useState<{ lat: number | null; lng: number | null }>({ lat: values.pickupLat, lng: values.pickupLng });
  const [radius, setRadius] = useState(values.pickupRadius);
  const [exact, setExact] = useState(values.pickupExact);
  const [place, setPlace] = useState(values.pickupPlace);
  // Název doplněný z mapy se smí přepsat dalším kliknutím, napsaný ručně ne.
  const [autoPlace, setAutoPlace] = useState(!values.pickupPlace);
  const [on, setOn] = useState<Set<Carrier>>(new Set(values.methods.map((m) => m.carrier)));
  const [codOn, setCodOn] = useState<Set<Carrier>>(new Set(values.methods.filter((m) => m.cod).map((m) => m.carrier)));
  const byKey = new Map(values.methods.map((m) => [m.carrier, m]));
  // Ceny a příplatky jsou skutečné hodnoty, žádná šedá nula: po zapnutí se předvyplní ceník dopravce.
  const [prices, setPrices] = useState<Partial<Record<Carrier, number>>>(Object.fromEntries(values.methods.map((m) => [m.carrier, m.price])));
  const [fees, setFees] = useState<Partial<Record<Carrier, number>>>(Object.fromEntries(values.methods.filter((m) => m.cod).map((m) => [m.carrier, m.codFee])));
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const toggle = (set: Set<Carrier>, key: Carrier, value: boolean) => {
    const next = new Set(set);
    if (value) next.add(key); else next.delete(key);
    return next;
  };

  return (
    <form onSubmit={keepForm(action)} className={styles.form}>
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <div className={styles.cols}>
        <section className={styles.card} aria-labelledby="platba">
          <h3 id="platba" className={styles.cardTitle}>Platba</h3>
          <label className={styles.check}>
            <input type="checkbox" name="transfer" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} />
            <span><strong>Bankovní převod předem</strong><small>Kupující dostane QR kód s variabilním symbolem.</small></span>
          </label>
          {transfer ? (
            <div className={styles.sub}>
              <label className={styles.field}>
                <span className={styles.label}>Číslo účtu</span>
                <input name="account" defaultValue={values.account} className={`${styles.input} code`} placeholder="123456789/0800" autoComplete="off" required />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Majitel účtu</span>
                <input name="accountName" maxLength={70} defaultValue={values.accountName} className={styles.input} required />
              </label>
            </div>
          ) : null}
          <label className={styles.check}>
            <input type="checkbox" name="paypal" checked={paypal} onChange={(e) => setPaypal(e.target.checked)} />
            <span><strong>PayPal</strong><small>Kupující dostane odkaz s částkou.</small></span>
          </label>
          {paypal ? (
            <div className={styles.sub}>
              <label className={styles.field}>
                <span className={styles.label}>Jméno PayPal.Me</span>
                <span className={styles.prefixed}>
                  <span className="code" aria-hidden>paypal.me/</span>
                  <input name="paypalMe" defaultValue={values.paypalMe} className={`${styles.input} code`} placeholder="kartydoupe" autoComplete="off" maxLength={60} required />
                </span>
                <small className={styles.note}>Jen jméno z vašeho odkazu PayPal.Me.</small>
              </label>
            </div>
          ) : null}
          <label className={styles.check}>
            <input type="checkbox" name="revolut" checked={revolut} onChange={(e) => setRevolut(e.target.checked)} />
            <span><strong>Revolut</strong><small>Kupující dostane odkaz na váš Revtag a částku.</small></span>
          </label>
          {revolut ? (
            <div className={styles.sub}>
              <label className={styles.field}>
                <span className={styles.label}>Revtag</span>
                <span className={styles.prefixed}>
                  <span className="code" aria-hidden>@</span>
                  <input name="revtag" defaultValue={values.revtag} className={`${styles.input} code`} placeholder="kartydoupe" autoComplete="off" maxLength={60} required />
                </span>
                <small className={styles.note}>Najdete ho v aplikaci Revolut v profilu.</small>
              </label>
            </div>
          ) : null}
          <label className={styles.check}>
            <input type="checkbox" name="cash" checked={cash} onChange={(e) => { setCash(e.target.checked); if (e.target.checked) setPickup(true); }} />
            <span><strong>Hotově při osobním předání</strong><small>{pickup ? 'Jen u osobního předání.' : 'Zapne i osobní předání.'}</small></span>
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={cod} onChange={(e) => setCod(e.target.checked)} />
            <span><strong>Dobírka</strong><small>Nastavíte u každého dopravce níže.</small></span>
          </label>
          <p className={styles.note}>Platby jdou přímo vám. V4cards peníze nepřijímá. U PayPalu žádejte jen platbu za zboží, platba přátelům porušuje pravidla PayPalu.</p>
        </section>

        <section className={styles.card} aria-labelledby="predani">
          <h3 id="predani" className={styles.cardTitle}>Osobní předání</h3>
          <label className={styles.check}>
            <input type="checkbox" name="pickup" checked={pickup} onChange={(e) => { setPickup(e.target.checked); if (!e.target.checked) setCash(false); }} />
            <span><strong>Nabízím osobní předání</strong></span>
          </label>
          {pickup ? (
            <div className={styles.subCol}>
              {/* Okruh (soukromník, poloha zaokrouhlená) nebo přesné místo (obchod, pobočka). */}
              <div className={styles.segment} role="radiogroup" aria-label="Jak ukázat místo">
                <label><input type="radio" name="pickupMode" value="radius" checked={!exact} onChange={() => setExact(false)} /><span>Okruh</span></label>
                <label><input type="radio" name="pickupMode" value="exact" checked={exact} onChange={() => setExact(true)} /><span>Přesné místo</span></label>
              </div>
              <PickupMap lat={pos.lat} lng={pos.lng} radiusKm={exact ? null : radius} onPick={(lat, lng) => {
                setPos({ lat, lng });
                if (autoPlace || !place.trim()) placeAt(lat, lng).then((name) => { if (name) { setPlace(name); setAutoPlace(true); } });
              }} />
              <input type="hidden" name="lat" value={pos.lat ?? ''} />
              <input type="hidden" name="lng" value={pos.lng ?? ''} />
              <div className={styles.sub}>
                <label className={styles.field}>
                  <span className={styles.label}>{exact ? 'Adresa (vidí kupující)' : 'Místo (vidí kupující)'}</span>
                  <PlaceInput
                    value={place}
                    onChange={(v) => { setPlace(v); setAutoPlace(false); }}
                    onPick={(p) => { setPos({ lat: p.lat, lng: p.lng }); setAutoPlace(false); }}
                  />
                </label>
{exact ? null : (
                <label className={`${styles.field} ${styles.narrow}`}>
                  <span className={styles.label}>Okruh (km)</span>
                  <input name="radius" type="number" min={1} max={50} value={radius} onChange={(e) => setRadius(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} className={`${styles.input} code`} />
                </label>
                )}
              </div>
              <small className={styles.note}>
                {exact
                  ? 'Pro obchody a pobočky: kupující uvidí přesnou adresu a špendlík. Začněte psát adresu, nebo klikněte do mapy.'
                  : 'Začněte psát místo, nebo klikněte do mapy, kde předáváte. Přesnou adresu kupující neuvidí, jen místo a okruh. Domluvíte se ve zprávách.'}
              </small>
            </div>
          ) : null}
        </section>
      </div>

      <section className={styles.card} aria-labelledby="doprava">
        <h3 id="doprava" className={styles.cardTitle}>Doprava</h3>
        <div className={styles.table} role="table" aria-label="Dopravci">
          <div className={`${styles.trow} ${styles.thead}`} role="row">
            <span role="columnheader" aria-label="Nabízím" />
            <span role="columnheader">DOPRAVCE</span>
            <span role="columnheader" className={styles.left}>CENA</span>
            <span role="columnheader" className={styles.center}>DOBÍRKA</span>
            <span role="columnheader" className={styles.left}>PŘÍPLATEK</span>
          </div>
          {CARRIERS.map((c) => {
            const m = byKey.get(c.key);
            const active = on.has(c.key);
            const hasCod = cod && active && codOn.has(c.key);
            const rate = values.rates[c.key];
            const cap = rate ? rate.price + SHIPPING_PACKING : null;
            const feeCap = rate?.codFee != null ? rate.codFee + COD_MARGIN : null;
            const price = prices[c.key];
            const over = active && cap != null && price != null && price > cap;
            return (
              <div key={c.key} className={styles.trow} data-off={active ? undefined : ''} role="row">
                <input type="checkbox" name={`c_${c.key}`} checked={active} onChange={(e) => {
                  setOn(toggle(on, c.key, e.target.checked));
                  if (e.target.checked && prices[c.key] == null && rate) setPrices({ ...prices, [c.key]: rate.price });
                }} aria-label={c.name} />
                <span className={styles.carrier}>
                  {c.key === 'custom' && active ? (
                    <input name="label_custom" maxLength={40} required defaultValue={m?.label ?? ''} className={styles.input} placeholder="např. Kurýr po Praze" aria-label="Název vlastního způsobu" />
                  ) : (
                    <strong>{c.name}</strong>
                  )}
                  {c.hint && c.key !== 'custom' ? <small>{c.hint}</small> : null}
                  {/* Strop ceny: ceník dopravce + balné (DS DeliveryPayment). */}
                  {rate && active ? (
                    <small className={over ? styles.over : undefined}>
                      {over ? `Nejvýš ${cap} Kč: ceník ${rate.price} Kč + ${SHIPPING_PACKING} Kč balné` : `ceník ${rate.price} Kč · nejvýš ${cap} Kč`}
                    </small>
                  ) : null}
                </span>
                <span className={styles.money} data-over={over ? '' : undefined}>
                  <input
                    name={`p_${c.key}`} type="number" min={0} max={cap ?? 1000} disabled={!active} required={active}
                    value={active ? price ?? '' : ''} onChange={(e) => setPrices({ ...prices, [c.key]: num(e.target.value) })}
                    className={`${styles.input} code`} aria-label={`Cena: ${c.name}`}
                  />
                  <span aria-hidden>Kč</span>
                </span>
                <span className={styles.codCell}>
                  <input type="checkbox" name={`cod_${c.key}`} checked={hasCod} disabled={!active || !cod} onChange={(e) => {
                    setCodOn(toggle(codOn, c.key, e.target.checked));
                    if (e.target.checked && fees[c.key] == null) setFees({ ...fees, [c.key]: rate?.codFee ?? 0 });
                  }} aria-label={`Dobírka: ${c.name}`} />
                </span>
                <span className={styles.money}>
                  <input name={`fee_${c.key}`} type="number" min={0} max={feeCap ?? 500} disabled={!hasCod} required={hasCod} value={hasCod ? fees[c.key] ?? '' : ''} onChange={(e) => setFees({ ...fees, [c.key]: num(e.target.value) })} className={`${styles.input} code`} aria-label={`Příplatek za dobírku: ${c.name}`} title={feeCap != null ? `Nejvýš ${feeCap} Kč (ceník ${rate?.codFee} Kč + ${COD_MARGIN} Kč)` : undefined} />
                  <span aria-hidden>Kč</span>
                </span>
              </div>
            );
          })}
        </div>
        <div className={styles.foot}>
          <label className={`${styles.field} ${styles.freeFrom}`}>
            <span className={styles.label}>Doprava zdarma od (Kč)</span>
            <input name="freeFrom" type="number" min={1} max={100000} defaultValue={values.freeFrom ?? ''} className={`${styles.input} code`} placeholder="např. 2000" />
            <small className={styles.note}>Nechte prázdné, když ne.</small>
          </label>
          <div className={styles.save}>
            {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
            {state.ok ? <p className={styles.ok} role="status">Uloženo.</p> : null}
            <Button type="submit" disabled={pending}>{pending ? 'Ukládám…' : 'Uložit'}</Button>
          </div>
        </div>
      </section>
    </form>
  );
}
