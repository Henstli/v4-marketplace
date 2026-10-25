import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { LoginForm } from './LoginForm';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Přihlášení' };

type Props = { searchParams: Promise<{ dalsi?: string; chyba?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) {
    return <ComingSoon title="Přihlášení" text="Přihlášení zapneme po připojení databáze." />;
  }
  const { dalsi, chyba } = await searchParams;
  const next = dalsi?.startsWith('/') && !dalsi.startsWith('//') ? dalsi : '/';
  if (await getCurrentUser()) redirect(next);

  return (
    <div className="container section">
      <div className={`panel ${styles.wrap}`}>
        <h1 className="t-heading-l">Přihlášení</h1>
        <p className="muted">Pošleme vám na e-mail odkaz, kterým se přihlásíte.</p>
        {chyba ? <p className={styles.error} role="alert">Odkaz už neplatí. Pošlete si prosím nový.</p> : null}
        <LoginForm next={next} />
      </div>
    </div>
  );
}
