import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/trezor';
import { createClient } from '@/lib/supabase/server';
import { KIND, PRIORITY, type CaseKind, type CasePriority } from '@/lib/support';
import { createCase } from '../actions';
import styles from '../podpora.module.css';

export const metadata: Metadata = { title: 'Nový případ · podpora' };

type Props = { searchParams: Promise<{ uzivatel?: string; chyba?: string }> };

/** Ruční založení případu: dotaz e-mailem nebo telefonem, odvolání, cokoli dalšího. */
export default async function NewCasePage({ searchParams }: Props) {
  const { uzivatel, chyba } = await searchParams;
  const supabase = await createClient();
  const { data: person } = uzivatel
    ? await supabase.from('profiles').select('id, display_name').eq('id', uzivatel).maybeSingle()
    : { data: null };

  return (
    <div className={styles.page}>
      <Link href="/sprava/podpora" className={styles.link}>← Fronta</Link>
      <h1 className="t-heading-l">Nový případ</h1>
      {chyba ? <p className={`${styles.flash} ${styles.flashErr}`}>{chyba}</p> : null}
      <form action={createCase} className={styles.box} style={{ maxWidth: 720 }}>
        {person ? <input type="hidden" name="user_id" value={person.id} /> : null}
        <label className={styles.field}>Předmět
          <input className={styles.input} name="subject" required minLength={3} maxLength={200} placeholder="Např. Nejde mi přihlášení přes Google" />
        </label>
        <div className={styles.two}>
          <label className={styles.field}>Typ
            <select className={styles.input} name="kind" defaultValue={person ? 'other' : 'question'}>
              {(Object.keys(KIND) as CaseKind[]).filter((k) => k !== 'report').map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
            </select>
          </label>
          <label className={styles.field}>Priorita
            <select className={styles.input} name="priority" defaultValue="mid">
              {(Object.keys(PRIORITY) as CasePriority[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
            </select>
          </label>
        </div>
        <label className={styles.field}>Uživatel
          {person
            ? <input className={styles.input} value={person.display_name} disabled />
            : <input className={styles.input} name="who" maxLength={200} placeholder="E-mail nebo přesná přezdívka (člověk bez účtu: jen e-mail)" />}
        </label>
        <label className={styles.field}>Co uživatel chce (interní poznámka)
          <textarea className={styles.input} name="body" maxLength={8000} placeholder="Shrnutí e-mailu nebo telefonátu" />
        </label>
        <p className={styles.small}>Termín se nastaví sám: dotaz 2 dny, odvolání 7 dní, vysoká priorita 1 den. Případ dostanete na sebe.</p>
        <div className={`${styles.row} ${styles.rowEnd}`}>
          <Button type="submit">Založit případ</Button>
        </div>
      </form>
    </div>
  );
}
