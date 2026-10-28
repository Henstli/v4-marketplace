'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/trezor';
import { handoverCase, mergeCase, setPriority, snoozeCase, updateCase } from '@/app/sprava/podpora/actions';
import { PRIORITY, STATUS, type CasePriority, type CaseStatus } from '@/lib/support';
import styles from '@/app/sprava/podpora/podpora.module.css';

interface Staff { id: string; name: string }

/** Stav a Řeší: uloží se hned po výběru, bez tlačítka Uložit. */
export function StatusForm({ caseId, status, assignee, staff }: { caseId: string; status: CaseStatus; assignee: string | null; staff: Staff[] }) {
  const form = useRef<HTMLFormElement>(null);
  const save = () => form.current?.requestSubmit();
  return (
    <form ref={form} action={updateCase} className={styles.two}>
      <input type="hidden" name="case_id" value={caseId} />
      <label className={styles.field}>Stav
        <select className={styles.input} name="status" defaultValue={status} onChange={save}>
          {(Object.keys(STATUS) as CaseStatus[]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
        </select>
      </label>
      <label className={styles.field}>Řeší
        <select className={styles.input} name="assignee" defaultValue={assignee ?? ''} onChange={save}>
          <option value="">Nikdo</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
    </form>
  );
}

type Panel = 'handover' | 'snooze' | 'merge' | 'priority' | null;

/** Předat, Odložit, Sloučit, Priorita: mřížka 2×2 tlačítek, formulář se rozbalí pod ní. */
export function CaseActions({ caseId, me, assignee, staff, snoozed, priority, due }: {
  caseId: string; me: string; assignee: string | null; staff: Staff[]; snoozed: boolean; priority: CasePriority; due: string;
}) {
  const [open, setOpen] = useState<Panel>(null);
  const toggle = (p: Panel) => setOpen((x) => (x === p ? null : p));
  const btn = (p: Exclude<Panel, null>, label: string) => (
    <button type="button" className={styles.actBtn} aria-expanded={open === p} onClick={() => toggle(p)}>{label}</button>
  );
  return (
    <>
      <div className={styles.actGrid}>
        {btn('handover', 'Předat…')}
        {btn('snooze', snoozed ? 'Odloženo' : 'Odložit')}
        {btn('merge', 'Sloučit')}
        {btn('priority', 'Priorita')}
      </div>
      {open === 'handover' ? (
        <form action={handoverCase} className={styles.actPanel}>
          <input type="hidden" name="case_id" value={caseId} />
          <label className={styles.field}>Komu
            <select className={styles.input} name="to" required defaultValue="">
              <option value="" disabled>Vyberte kolegu</option>
              {staff.filter((s) => s.id !== assignee && s.id !== me).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className={styles.field}>Proč (nepovinné)
            <input className={styles.input} name="note" maxLength={500} placeholder="Např. potřebuje ověřit platbu" />
          </label>
          <Button type="submit">Předat případ</Button>
        </form>
      ) : null}
      {open === 'snooze' ? (
        <form action={snoozeCase} className={styles.actPanel}>
          <input type="hidden" name="case_id" value={caseId} />
          <span className={styles.small}>Do té doby se případ ve frontě neukáže. Odpověď uživatele ho vrátí hned.</span>
          <div className={styles.row}>
            <Button type="submit" name="days" value="1" variant="secondary">1 den</Button>
            <Button type="submit" name="days" value="3" variant="secondary">3 dny</Button>
            <Button type="submit" name="days" value="7" variant="secondary">Týden</Button>
          </div>
          <div className={styles.row}>
            <input className={styles.input} style={{ flex: 1 }} type="datetime-local" name="until" aria-label="Vlastní datum" />
            <Button type="submit" variant="secondary">Odložit</Button>
          </div>
          {snoozed ? <Button type="submit" name="cancel" value="1" variant="ghost">Zrušit odložení</Button> : null}
        </form>
      ) : null}
      {open === 'merge' ? (
        <form action={mergeCase} className={styles.actPanel}>
          <input type="hidden" name="case_id" value={caseId} />
          <label className={styles.field}>Sloučit do případu
            <input className={styles.input} name="into" required placeholder="P-0128" />
          </label>
          <span className={styles.small}>Osa, přílohy a nahlášení se přesunou tam, tento případ se uzavře s odkazem.</span>
          <Button type="submit">Sloučit</Button>
        </form>
      ) : null}
      {open === 'priority' ? (
        <form action={setPriority} className={styles.actPanel}>
          <input type="hidden" name="case_id" value={caseId} />
          <div className={styles.two}>
            <label className={styles.field}>Priorita
              <select className={styles.input} name="priority" defaultValue={priority}>
                {(Object.keys(PRIORITY) as CasePriority[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
              </select>
            </label>
            <label className={styles.field}>Termín
              <input className={styles.input} type="datetime-local" name="due" defaultValue={due} />
            </label>
          </div>
          <Button type="submit">Uložit</Button>
        </form>
      ) : null}
    </>
  );
}
