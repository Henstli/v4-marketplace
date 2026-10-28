import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RestrictForm } from '@/components/support/RestrictForm';
import { createClient } from '@/lib/supabase/server';
import styles from '../../../podpora.module.css';

export const metadata: Metadata = { title: 'Omezit účet · podpora' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ pripad?: string; chyba?: string }> };

/** Omezení účtu s odůvodněním podle nařízení o digitálních službách (DS Support, Omezit účet). */
export default async function RestrictPage({ params, searchParams }: Props) {
  const [{ id }, { pripad, chyba }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: person }, { data: cases }] = await Promise.all([
    supabase.from('profiles').select('id, display_name, kind').eq('id', id).maybeSingle(),
    supabase.from('support_cases').select('id, number, subject').or(`user_id.eq.${id},other_id.eq.${id}`)
      .neq('status', 'resolved').order('created_at', { ascending: false }).limit(20),
  ]);
  if (!person) notFound();
  const list = (cases ?? []) as Array<{ id: string; number: number; subject: string }>;
  // Případ, ze kterého podpora přišla, nabídneme jako první.
  const sorted = pripad ? [...list].sort((a, b) => (a.id === pripad ? -1 : b.id === pripad ? 1 : 0)) : list;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link href={`/sprava/podpora/uzivatele/${id}`} className={styles.link}>← {person.display_name}</Link>
      </div>
      <h1 className="t-heading-l">Omezit účet</h1>
      {chyba ? <p className={`${styles.flash} ${styles.flashErr}`}>{chyba}</p> : null}
      <RestrictForm userId={id} name={person.display_name} isShop={person.kind === 'shop'} cases={sorted} />
    </div>
  );
}
