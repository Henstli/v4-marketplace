import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import styles from '@/components/auth/auth.module.css';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { NewPasswordForm } from './NewPasswordForm';

export const metadata: Metadata = { title: 'Nové heslo' };

export default async function NewPasswordPage() {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/zapomenute-heslo');

  return (
    <div className="container section">
      <div className={`panel ${styles.wrap}`}>
        <div>
          <h1 className="t-heading-l">Nové heslo</h1>
          <p className="muted">Nastavte si heslo pro účet {user.email}.</p>
        </div>
        <NewPasswordForm email={user.email} />
        <p className="t-small muted"><Link href="/ucet">Zpět na účet</Link></p>
      </div>
    </div>
  );
}
