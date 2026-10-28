import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { caseCode } from '@/lib/support';
import styles from '../../podpora.module.css';

export const metadata: Metadata = { title: 'Zprávy mezi stranami · podpora' };

type Props = { params: Promise<{ cislo: string }> };

interface Msg { id: number; sender_id: string | null; sender: string | null; kind: string; body: string; created_at: string; hidden_at: string | null }

/**
 * Zprávy mezi kupujícím a prodejcem objednávky z případu. Každé otevření zapíše databáze
 * do Záznamu akcí a do osy případu (admin_case_messages).
 */
export default async function CaseMessagesPage({ params }: Props) {
  const { cislo } = await params;
  const number = Number(cislo);
  if (!Number.isInteger(number) || number < 1) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from('support_cases').select('id, number, subject, order_id').eq('number', number).maybeSingle();
  if (!c?.order_id) notFound();
  const { data, error } = await supabase.rpc('admin_case_messages', { p_case: c.id });
  const rows = ((data ?? []) as Msg[]).slice().reverse();

  return (
    <div className={styles.page}>
      <Link href={`/sprava/podpora/${c.number}`} className={styles.link}>← {caseCode(c.number)} · {c.subject}</Link>
      <h1 className="t-heading-l">Zprávy mezi stranami</h1>
      <p className={styles.small}>Otevření jsme zapsali do Záznamu akcí a do osy případu. Zprávy čtěte jen v rozsahu potřebném pro řešení případu.</p>
      {error ? <p className={`${styles.flash} ${styles.flashErr}`}>{error.message}</p> : null}
      <ol className={styles.timeline} style={{ maxWidth: 760 }}>
        {rows.map((m) => (
          <li key={m.id}>
            <div className={styles.msg}>
              <span className={styles.small}>{m.sender ?? 'smazaný účet'} · {formatDateTime(m.created_at)}{m.hidden_at ? ' · skryto podporou' : ''}</span>
              <div className={styles.msgBody}>{m.body}</div>
            </div>
          </li>
        ))}
        {!error && !rows.length ? <li className={styles.small}>Strany si zatím nepsaly.</li> : null}
      </ol>
    </div>
  );
}
