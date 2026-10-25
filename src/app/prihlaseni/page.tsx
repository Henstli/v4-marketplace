import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { GoogleButton } from '@/components/auth/GoogleButton';
import styles from '@/components/auth/auth.module.css';
import { getCurrentUser } from '@/lib/auth';
import { authProviders, safeNext } from '@/lib/auth-helpers';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Přihlášení' };

type Props = { searchParams: Promise<{ dalsi?: string; chyba?: string}> };

const ERRORS: Record<string, string> = {
  odkaz: 'Odkaz už neplatí nebo byl otevřen v jiném prohlížeči. Přihlaste se prosím znovu.',
  google: 'Přihlášení přes Google se nepovedlo. Zkuste to prosím znovu.',
};

export default async function LoginPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) {
    return <ComingSoon title="Přihlášení" text="Přihlášení zapneme po připojení databáze." />;
  }
  const { dalsi, chyba } = await searchParams;
  const next = safeNext(dalsi);
  if (await getCurrentUser()) redirect(next);
  const { google } = await authProviders();
  const signupHref = next === '/' ? '/registrace' : `/registrace?dalsi=${encodeURIComponent(next)}`;

  return (
    <div className="container section">
      <div className={`panel ${styles.wrap}`}>
        <div>
          <h1 className="t-heading-l">Přihlášení</h1>
          <p className="muted">Nemáte účet? <Link href={signupHref}>Zaregistrujte se</Link></p>
        </div>
        {chyba ? <p className={styles.error} role="alert">{ERRORS[chyba] ?? ERRORS.odkaz}</p> : null}
        {google ? <GoogleButton next={next} /> : null}
        <LoginForm next={next} />
        <p className="t-small muted">Přihlašovali jste se dřív odkazem z e-mailu? Heslo si nastavíte přes Zapomenuté heslo.</p>
      </div>
    </div>
  );
}
