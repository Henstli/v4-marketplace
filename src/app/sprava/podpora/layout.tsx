import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SupportNav } from '@/components/support/SupportNav';
import { BeatProvider } from '@/components/support/Beat';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import styles from './podpora.module.css';

/**
 * Režim podpory: vlastní rozložení bez hlavičky a patičky webu a levý panel (DS Support, Režim podpory).
 * Čas se počítá sám (BeatProvider). Jen pro počítač, na úzké obrazovce jen odkaz zpět na web.
 */
export default async function SupportLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/sprava/podpora');
  if (!user.isStaff) notFound();
  const supabase = await createClient();
  const { count: late } = await supabase.from('support_cases').select('id', { count: 'exact', head: true })
    .eq('status', 'open').lt('due_at', new Date().toISOString()).or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`);

  return (
    <>
      <div className={styles.app}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <span className={styles.monogram} aria-hidden="true">V4</span>
            <span>V4cards</span>
            <span className={styles.modePill}>PODPORA</span>
          </div>
          <SupportNav late={late ?? 0} className={styles.nav} itemClass={styles.navItem} countClass={styles.navCount} />
          <div className={styles.sideFoot}>
            <span className={styles.small}>Přihlášen: {user.displayName} · {user.isAdmin ? 'správce' : 'podpora'}</span>
            <Link href="/" className={styles.link}>Přejít na web</Link>
          </div>
        </aside>
        <div className={styles.content}>
          <BeatProvider>{children}</BeatProvider>
        </div>
      </div>
      <div className={styles.desktopOnly}>
        <p>Podpora funguje na počítači. Otevřete ji na větší obrazovce.</p>
        <Link href="/" className={styles.link}>Přejít na web</Link>
      </div>
    </>
  );
}
