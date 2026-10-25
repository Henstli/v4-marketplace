import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { getCurrentUser } from '@/lib/auth';
import { FREE_ROW_LIMIT } from '@/lib/import/columns';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { ImportWizard } from './ImportWizard';
import styles from './import.module.css';

export const metadata: Metadata = { title: 'Hromadné nahrávání nabídek' };

export default async function ImportPage() {
  if (!isSupabaseConfigured()) {
    return <ComingSoon title="Hromadné nahrávání" text="Nahrávání nabídek zapneme po připojení databáze." />;
  }
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/prodat/import');

  const supabase = await createClient();
  const { data: subscribed } = await supabase.rpc('has_subscription');

  return (
    <div className={`container ${styles.page}`}>
      <div>
        <p className="t-small muted"><Link href="/prodat">Prodat karty</Link> / Hromadné nahrávání</p>
        <h1 className="t-heading-l">Hromadné nahrávání nabídek</h1>
        <p className="muted">Nahrajte celý sklad z tabulky: karty spárujeme s katalogem, zkontrolujete je a vystavíte jedním tlačítkem.</p>
      </div>
      <ImportWizard limit={subscribed === true ? null : FREE_ROW_LIMIT} />
    </div>
  );
}
