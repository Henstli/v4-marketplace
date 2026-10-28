import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SupportTabs } from '@/components/support/SupportTabs';
import { Ticker } from '@/components/support/Ticker';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { caseCode } from '@/lib/support';
import { stopTimer } from './actions';
import styles from './podpora.module.css';

/** Rám panelu podpory: záložky a běžící časovač nad každou stránkou (DS Support). */
export default async function SupportLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/sprava/podpora');
  if (!user.isAdmin) notFound();
  const supabase = await createClient();
  const { data: running } = await supabase.from('case_time')
    .select('started_at, support_cases(number)')
    .eq('staff_id', user.id).is('ended_at', null).maybeSingle<{ started_at: string; support_cases: { number: number } | null }>();
  const num = running?.support_cases?.number;

  return (
    <div className="container">
      <div className={styles.bar}>
        <SupportTabs className={styles.tabs} />
        {running && num ? (
          <form action={stopTimer} className={styles.timer}>
            <input type="hidden" name="back" value={`/sprava/podpora/${num}`} />
            <span>Pracujete na <Link href={`/sprava/podpora/${num}`}>{caseCode(num)}</Link> · <Ticker since={running.started_at} /></span>
            <button type="submit" className={styles.timerBtn}>Zastavit</button>
          </form>
        ) : null}
      </div>
      {children}
    </div>
  );
}
