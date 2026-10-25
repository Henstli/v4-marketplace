import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import styles from '@/components/auth/auth.module.css';
import { safeNext } from '@/lib/auth-helpers';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '../actions';
import { VerifyForm } from './VerifyForm';

export const metadata: Metadata = { title: 'Dvoufázové ověření' };

type Props = { searchParams: Promise<{ dalsi?: string }> };

export default async function VerifyPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const next = safeNext((await searchParams).dalsi);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/prihlaseni');
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!(aal?.currentLevel === 'aal1' && aal.nextLevel === 'aal2')) redirect(next);

  return (
    <div className="container section">
      <div className={`panel ${styles.wrap}`}>
        <div>
          <h1 className="t-heading-l">Dvoufázové ověření</h1>
          <p className="muted">Otevřete ověřovací aplikaci v telefonu a opište kód pro V4cards.</p>
        </div>
        <VerifyForm next={next} />
        <form action={signOut}>
          <button type="submit" className="tz-btn tz-btn-ghost tz-btn-md">Odhlásit se</button>
        </form>
      </div>
    </div>
  );
}
