import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import styles from '@/components/messages/messages.module.css';

export const metadata: Metadata = { title: 'Zprávy' };

export default async function MessagesPage() {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/zpravy');
  return (
    <div className={styles.empty}>
      <h2 className="t-heading-m">Vyberte konverzaci</h2>
      <p className="muted">
        Prodejci napíšete z jeho stránky tlačítkem „Napsat zprávu“, u objednávky najdete odkaz
        na zprávy s druhou stranou. <Link href="/objednavky">Objednávky</Link>
      </p>
    </div>
  );
}
