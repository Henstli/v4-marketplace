import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import styles from '@/components/auth/auth.module.css';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { NewPasswordForm } from './NewPasswordForm';

export const metadata: Metadata = { title: 'Nové heslo' };

export default async function NewPasswordPage() {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/zapomenute-heslo');
  const supabase = await createClient();
  const [{ data: recovery }, { data: hasPassword }] = await Promise.all([
    supabase.rpc('recent_password_recovery'),
    supabase.rpc('has_password'),
  ]);
  const askCurrent = hasPassword === true && recovery !== true;

  return (
    <div className="container section">
      <div className={`panel ${styles.wrap}`}>
        <div>
          <h1 className="t-heading-l">{askCurrent ? 'Změna hesla' : 'Nové heslo'}</h1>
          <p className="muted">
            {askCurrent ? `Účet ${user.email}. Pro jistotu zadejte i současné heslo.` : `Nastavte si heslo pro účet ${user.email}.`}
          </p>
        </div>
        <NewPasswordForm email={user.email} askCurrent={askCurrent} />
        <p className="t-small muted">
          {askCurrent ? <><Link href="/zapomenute-heslo">Nepamatujete si současné heslo?</Link> · </> : null}
          <Link href="/ucet">Zpět na účet</Link>
        </p>
      </div>
    </div>
  );
}
