import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SupportNav } from '@/components/support/SupportNav';
import { Ticker } from '@/components/support/Ticker';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { caseCode } from '@/lib/support';
import { stopTimer } from './actions';
import styles from './podpora.module.css';

/**
 * Režim podpory: vlastní rozložení bez hlavičky a patičky webu, levý panel a běžící časovač
 * (DS Support, Režim podpory). Jen pro počítač, na úzké obrazovce jen odkaz zpět na web.
 */
export default async function SupportLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/sprava/podpora');
  if (!user.isStaff) notFound();
  const supabase = await createClient();
  const [{ data: running }, { count: late }] = await Promise.all([
    supabase.from('case_time').select('started_at, support_cases(number)')
      .eq('staff_id', user.id).is('ended_at', null).maybeSingle<{ started_at: string; support_cases: { number: number } | null }>(),
    supabase.from('support_cases').select('id', { count: 'exact', head: true }).eq('status', 'open').lt('due_at', new Date().toISOString()),
  ]);
  const num = running?.support_cases?.number;

  return (
    <>
      <div className={styles.app}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <span className={styles.monogram} aria-hidden="true">V4</span>
            <span>V4cards</span>
            <span className={styles.modePill}>PODPORA</span>
          </div>
          <SupportNav late={late ?? 0} admin={user.isAdmin} className={styles.nav} itemClass={styles.navItem} countClass={styles.navCount} />
          <div className={styles.sideFoot}>
            <span className={styles.small}>Přihlášen: {user.displayName} · {user.isAdmin ? 'správce' : 'podpora'}</span>
            <Link href="/" className={styles.link}>Přejít na web</Link>
          </div>
        </aside>
        <div className={styles.content}>
          {running && num ? (
            <div className={styles.bar}>
              <form action={stopTimer} className={styles.timer}>
                <input type="hidden" name="back" value={`/sprava/podpora/${num}`} />
                <span>Pracujete na <Link href={`/sprava/podpora/${num}`}>{caseCode(num)}</Link> · <Ticker since={running.started_at} /></span>
                <button type="submit" className={styles.timerBtn}>Zastavit</button>
              </form>
            </div>
          ) : null}
          {children}
        </div>
      </div>
      <div className={styles.desktopOnly}>
        <p>Podpora funguje na počítači. Otevřete ji na větší obrazovce.</p>
        <Link href="/" className={styles.link}>Přejít na web</Link>
      </div>
    </>
  );
}
