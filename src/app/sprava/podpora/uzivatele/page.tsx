import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchField } from '@/components/trezor';
import { createClient } from '@/lib/supabase/server';
import styles from '../podpora.module.css';

export const metadata: Metadata = { title: 'Uživatelé · podpora' };

type Props = { searchParams: Promise<{ q?: string }> };

/** Hledání uživatele podle přezdívky nebo e-mailu. */
export default async function SupportUsersPage({ searchParams }: Props) {
  const { q = '' } = await searchParams;
  const supabase = await createClient();
  const { data } = q.trim().length >= 2 ? await supabase.rpc('admin_find_users', { p_q: q }) : { data: [] };
  const rows = (data ?? []) as Array<{ id: string; display_name: string; email: string; kind: string }>;

  return (
    <div className={styles.page}>
      <h1 className="t-heading-l">Uživatelé</h1>
      <form action="/sprava/podpora/uzivatele" style={{ maxWidth: 480 }}>
        <SearchField name="q" defaultValue={q} placeholder="Přezdívka nebo e-mail" label="Hledat uživatele" autoFocus />
      </form>
      {q.trim().length >= 2 ? (
        <div className={styles.box}>
          <ul className={styles.list}>
            {rows.map((u) => (
              <li key={u.id}>
                <Link href={`/sprava/podpora/uzivatele/${u.id}`} className={styles.caseLink}>
                  <strong>{u.display_name}</strong>
                  <span className={styles.qmuted}>{u.email} · {u.kind === 'shop' ? 'Obchod' : 'Sběratel'}</span>
                </Link>
              </li>
            ))}
            {!rows.length ? <li className={styles.small}>Nikoho jsme nenašli.</li> : null}
          </ul>
        </div>
      ) : <p className={styles.small}>Zadejte aspoň 2 znaky.</p>}
    </div>
  );
}
