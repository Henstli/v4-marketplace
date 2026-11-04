'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/trezor';
import { CONDITION_NAMES, CONDITIONS, LANGUAGE_NAMES, type Language } from '@/lib/types';
import { createListing, type ListingState } from './actions';
import styles from './sell.module.css';

/**
 * Přidání karty do skladu/sbírky: hned prodávat, nebo jen mít (mimo prodej, cena nepovinná).
 * `ready`: prodejce má dopravu a platbu; bez nich jde kartu jen přidat mimo prodej.
 * `owner`: sklad obchodu, kam přidává člověk z týmu (jen mimo prodej, na prodej ji dá kdo smí měnit ceny).
 */
export function ListingForm({ cardId, ready, shop, owner }: { cardId: string; ready: boolean; shop: boolean; owner?: string }) {
  const [state, action, pending] = useActionState<ListingState, FormData>(createListing, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<'sell' | 'keep'>(ready && !owner ? 'sell' : 'keep');
  // Cena dohodou: bez ceny, kupující pošle návrh (DS OfferTable).
  const [negotiable, setNegotiable] = useState(false);
  const [done, setDone] = useState<'sell' | 'keep' | null>(null);
  useEffect(() => {
    if (state.ok) { formRef.current?.reset(); setNegotiable(false); }
  }, [state]);
  const sell = mode === 'sell';

  return (
    <form ref={formRef} action={(fd) => { setDone(mode); action(fd); }} className={styles.form}>
      <input type="hidden" name="card" value={cardId} />
      <input type="hidden" name="mode" value={mode} />
      {owner ? <input type="hidden" name="owner" value={owner} /> : (
        <div className={`${styles.wide} tz-stk-tools`} role="radiogroup" aria-label="Co s kartou">
          <button type="button" className="tz-stk-fbtn" aria-pressed={sell} onClick={() => setMode('sell')}>Hned prodávat</button>
          <button type="button" className="tz-stk-fbtn" aria-pressed={!sell} onClick={() => setMode('keep')}>Jen do {shop ? 'skladu' : 'sbírky'}, zatím neprodávat</button>
        </div>
      )}
      {owner ? <p className={`${styles.wide} t-small muted`}>Karta se přidá do skladu obchodu mimo prodej. Na prodej ji dá ten, kdo smí měnit ceny.</p> : null}
      <label className={styles.field}>
        <span className="t-label muted">STAV</span>
        <select name="condition" required defaultValue="NM" className={styles.input}>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c} · {CONDITION_NAMES[c]}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span className="t-label muted">JAZYK</span>
        <select name="language" required defaultValue="en" className={styles.input}>
          {(Object.keys(LANGUAGE_NAMES) as Language[]).map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}
        </select>
      </label>
      <div className={styles.field}>
        {negotiable && sell ? null : (
          <label className={styles.field}>
            <span className="t-label muted">CENA ZA KUS (KČ){sell ? '' : ', NEPOVINNÁ'}</span>
            <input name="price" type="number" min={1} step={1} required={sell} inputMode="numeric" className={styles.input} />
          </label>
        )}
        {sell ? (
          <label className={styles.check}>
            <input type="checkbox" name="negotiable" checked={negotiable} onChange={(e) => setNegotiable(e.target.checked)} />
            <span>Cena dohodou</span>
          </label>
        ) : null}
        {negotiable && sell ? <span className="t-small muted">Kupující vám pošlou návrh ceny, vy ho přijmete, nebo navrhnete jinou.</span> : null}
      </div>
      <label className={styles.field}>
        <span className="t-label muted">POČET KUSŮ</span>
        <input name="quantity" type="number" min={1} max={999} step={1} defaultValue={1} required className={styles.input} />
      </label>
      <label className={styles.field}>
        <span className="t-label muted">GRADING (NEPOVINNÉ)</span>
        <input name="graded" placeholder="např. PSA 9" maxLength={20} className={styles.input} />
      </label>
      <label className={`${styles.field} ${styles.wide}`}>
        <span className="t-label muted">POZNÁMKA (NEPOVINNÁ)</span>
        <input name="note" placeholder="např. drobné odření rohu" maxLength={200} className={styles.input} />
      </label>
      <div className={`${styles.wide} ${styles.submit}`}>
        <Button type="submit" size="lg" disabled={pending || (sell && !ready)}>
          {pending ? 'Ukládám…' : sell ? 'Vystavit kartu' : `Přidat do ${shop ? 'skladu' : 'sbírky'}`}
        </Button>
        {sell && !ready ? <p className={styles.blocked}>Prodávat jde až s dopravou a platbou. Kartu můžete zatím přidat mimo prodej.</p> : null}
        {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
        {state.ok ? <p className={styles.ok} role="status">{done === 'keep' ? `Karta je ve ${shop ? 'skladu' : 'sbírce'} mimo prodej.` : 'Karta je vystavená.'}</p> : null}
      </div>
    </form>
  );
}
