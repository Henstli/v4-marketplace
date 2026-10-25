import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { getCurrentUser } from '@/lib/auth';
import { ButtonLink } from '@/components/trezor';
import { PLANS, toPlan } from '@/lib/plans';
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
  const { data: plan } = await supabase.rpc('current_plan');

  return (
    <div className={`container ${styles.page}`}>
      <div>
        <p className="t-small muted"><Link href="/prodat">Prodat karty</Link> / Hromadné nahrávání</p>
        <h1 className="t-heading-l">Hromadné nahrávání nabídek</h1>
        <p className="muted">Nahrajte celý sklad z tabulky: karty spárujeme s katalogem, zkontrolujete je a vystavíte jedním tlačítkem.</p>
      </div>
      {PLANS[toPlan(plan)].bulkImport ? (
        <ImportWizard />
      ) : (
        <section className={`panel ${styles.upsell}`}>
          <h2 className="t-heading-m">Hromadné nahrávání je součástí tarifu Pro</h2>
          <p className="muted">
            S tarifem Pro nahrajete celý sklad najednou, bez omezení počtu řádků: CSV, Excel i export z Cardmarketu.
            Placení zatím nespouštíme, tarif Pro vám přidělíme na požádání.
          </p>
          <div className={styles.upsellActions}>
            <ButtonLink href="mailto:podpora@v4cards.com?subject=Tarif%20Pro">Požádat o tarif Pro</ButtonLink>
            <ButtonLink href="/prodat" variant="ghost">Vystavit kartu ručně</ButtonLink>
          </div>
        </section>
      )}
    </div>
  );
}
