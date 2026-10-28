'use client';

import { useState } from 'react';
import { Button } from '@/components/trezor';
import { addNote, sendCaseEmail } from '@/app/sprava/podpora/actions';
import { TEMPLATES } from '@/lib/support';
import styles from '@/app/sprava/podpora/podpora.module.css';

export interface ReplyTarget { id: 'user' | 'other' | 'both' | 'contact'; label: string }

/** Odpověď e-mailem nebo interní poznámka pod časovou osou případu (DS Support, Případ). */
export function ReplyBox({ caseId, number, targets }: { caseId: string; number: number; targets: ReplyTarget[] }) {
  const [tab, setTab] = useState<'email' | 'note'>(targets.length ? 'email' : 'note');
  const [text, setText] = useState('');

  return (
    <div className={styles.box}>
      <div className={styles.seg} role="group" aria-label="Typ odpovědi">
        <button type="button" aria-pressed={tab === 'email'} disabled={!targets.length} onClick={() => setTab('email')}>Odpověď e-mailem</button>
        <button type="button" aria-pressed={tab === 'note'} onClick={() => setTab('note')}>Interní poznámka</button>
      </div>
      {tab === 'email' ? (
        <form action={sendCaseEmail} className={styles.main}>
          <input type="hidden" name="case_id" value={caseId} />
          <div className={styles.two}>
            <label className={styles.field}>Komu
              <select className={styles.input} name="to" defaultValue={targets[0]?.id}>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label className={styles.field}>Šablona
              <select className={styles.input} defaultValue="" onChange={(e) => {
                const t = TEMPLATES.find((x) => x.id === e.target.value);
                if (t) setText(t.text);
              }}>
                <option value="">Bez šablony</option>
                {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <label className={styles.field}>Text odpovědi
            <textarea className={styles.input} name="body" rows={8} required minLength={10} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <p className={styles.small}>Každý příjemce dostane e-mail zvlášť z podpora@v4cards.com, s P-{String(number).padStart(4, '0')} v předmětu. Kopie jde do schránky podpory.</p>
          <div className={styles.row}>
            <label className={styles.check}><input type="checkbox" name="waiting" defaultChecked /> Po odeslání nastavit „Čeká na uživatele“</label>
            <span style={{ flex: 1 }} />
            <Button type="submit">Odeslat e-mail</Button>
          </div>
        </form>
      ) : (
        <form action={addNote} className={styles.main}>
          <input type="hidden" name="case_id" value={caseId} />
          <input type="hidden" name="number" value={number} />
          <label className={styles.field}>Poznámka (uživatel ji nevidí)
            <textarea className={styles.input} name="body" rows={5} required maxLength={8000} />
          </label>
          <div className={`${styles.row} ${styles.rowEnd}`}><Button type="submit" variant="secondary">Uložit poznámku</Button></div>
        </form>
      )}
    </div>
  );
}
