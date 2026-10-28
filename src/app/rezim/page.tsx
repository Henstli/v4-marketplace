import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/auth-helpers';
import { getCurrentUser } from '@/lib/auth';
import { chooseMode } from './actions';
import styles from './rezim.module.css';

export const metadata: Metadata = { title: 'Kam chcete jít?' };

type Props = { searchParams: Promise<{ dalsi?: string }> };

/**
 * Rozcestník po přihlášení (DS Support, Režim podpory). Vidí ho jen člověk s rolí podpory na počítači,
 * všechny ostatní pošle rovnou na stránku, odkud se přihlašovali.
 */
export default async function ModePage({ searchParams }: Props) {
  const next = safeNext((await searchParams).dalsi);
  const user = await getCurrentUser();
  if (!user?.isAdmin) redirect(next);
  const ua = (await headers()).get('user-agent') ?? '';
  if (/Mobi|Android|iPhone|iPad/i.test(ua)) redirect(next);
  const remembered = (await cookies()).get('v4-rezim')?.value;
  if (remembered === 'web') redirect(next);
  if (remembered === 'podpora') redirect('/sprava/podpora');

  return (
    <div className={styles.page}>
      <form action={chooseMode} className={styles.card}>
        <input type="hidden" name="dalsi" value={next} />
        <h1 className={styles.title}>Kam chcete jít?</h1>
        <button type="submit" name="mode" value="web" className={styles.option}>
          <span className={styles.icon} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="12" height="16" rx="2" /><path d="M9 3h10a2 2 0 0 1 2 2v14" /></svg>
          </span>
          <span><strong>Web V4cards</strong><small>Nakupujte a prodávejte jako běžný uživatel</small></span>
        </button>
        <button type="submit" name="mode" value="podpora" className={styles.option}>
          <span className={styles.icon} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 13a8 8 0 0 1 16 0" /><rect x="3" y="13" width="4" height="6" rx="1.5" /><rect x="17" y="13" width="4" height="6" rx="1.5" /></svg>
          </span>
          <span><strong>Podpora</strong><small>Fronta případů, uživatelé a výkaz času</small></span>
        </button>
        <label className={styles.remember}><input type="checkbox" name="remember" /> Pamatovat si volbu na tomto počítači</label>
      </form>
    </div>
  );
}
