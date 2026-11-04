'use client';

import { useState } from 'react';
import { Button } from '@/components/trezor';
import { CONDITIONS, CONDITION_NAMES, LANGUAGE_NAMES } from '@/lib/types';
import s from './kolekce.module.css';

const LANGS = ['en', 'ja', 'de', 'cs', 'fr', 'it', 'es'] as const;

/**
 * „Mám ji“ u karty, která není ve sbírce: stav a jazyk, karta se uloží do sbírky mimo prodej a hned vloží do alba.
 * Kolekce bere karty jen ze sbírky (skladu), proto se bez stavu a jazyka vložit nedá.
 */
export function HaveForm({ name, pending, onSave, onCancel }: {
  name: string; pending: boolean; onSave: (cond: string, lang: string) => void; onCancel?: () => void;
}) {
  const [cond, setCond] = useState('NM');
  const [lang, setLang] = useState('en');
  return (
    <div className={s.have}>
      <p className={s.hint} style={{ margin: 0 }}><b style={{ color: 'var(--ink)' }}>{name}</b> zatím ve sbírce nemáte. Uloží se mimo prodej a hned vloží do alba.</p>
      <div className={s.haveRow}>
        <span>Stav</span>
        <div className={s.seg} role="radiogroup" aria-label="Stav">
          {CONDITIONS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cond === c} title={CONDITION_NAMES[c]} onClick={() => setCond(c)}>{c}</button>
          ))}
        </div>
      </div>
      <div className={s.haveRow}>
        <span>Jazyk</span>
        <select className={s.sel} value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Jazyk">
          {LANGS.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}
        </select>
      </div>
      <div className={s.haveBtns}>
        {onCancel ? <Button variant="ghost" size="md" onClick={onCancel}>Zrušit</Button> : null}
        <Button size="md" disabled={pending} onClick={() => onSave(cond, lang)}>{pending ? 'Ukládám…' : 'Uložit a vložit'}</Button>
      </div>
    </div>
  );
}
