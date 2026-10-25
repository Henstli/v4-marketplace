import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { GoogleButton } from '@/components/auth/GoogleButton';
import styles from '@/components/auth/auth.module.css';
import { getCurrentUser } from '@/lib/auth';
import { authProviders, safeNext } from '@/lib/auth-helpers';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { SignupForm } from './SignupForm';

export const metadata: Metadata = { title: 'Registrace' };

type Props = { searchParams: Promise<{ dalsi?: string }> };

export default async function SignupPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) {
    return <ComingSoon title="Registrace" text="Registraci zapneme po připojení databáze." />;
  }
  const next = safeNext((await searchParams).dalsi);
  if (await getCurrentUser()) redirect(next);
  const { google } = await authProviders();
  const loginHref = next === '/' ? '/prihlaseni' : `/prihlaseni?dalsi=${encodeURIComponent(next)}`;

  return (
    <div className="container section">
      <div className={`panel ${styles.wrap}`}>
        <div>
          <h1 className="t-heading-l">Registrace</h1>
          <p className="muted">Máte už účet? <Link href={loginHref}>Přihlaste se</Link></p>
        </div>
        {google ? <GoogleButton next={next} /> : null}
        <SignupForm next={next} />
      </div>
    </div>
  );
}
