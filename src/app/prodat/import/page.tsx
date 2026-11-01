import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { getCurrentUser } from '@/lib/auth';
import { getAccountSummary } from '@/lib/account';
import { StockTabs } from '@/components/account/PageTabs';
import { ButtonLink } from '@/components/trezor';
import { PLANS, toPlan } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { loadReadiness, SellGate } from '@/components/delivery/SellGate';
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
  const [{ data: plan }, ready, account] = await Promise.all([supabase.rpc('current_plan'), loadReadiness(supabase, user.id), getAccountSummary()]);

  return (
    <div className={`container ${styles.page}`}>
      <div>
        <h1 className="t-heading-l">{account?.kind === 'shop' ? 'Sklad' : 'Sbírka'}</h1>
        <p className="muted">Nahrajte celý sklad z tabulky: karty spárujeme s katalogem, zkontrolujete je a vystavíte jedním tlačítkem.</p>
        <StockTabs current="/prodat/import" listings={account?.listings ?? 0} />
      </div>
      {PLANS[toPlan(plan)].bulkImport ? (
        ready.ready ? (
          <ImportWizard />
        ) : (
          <>
            <SellGate r={ready} back="import" />
            <div inert style={{ opacity: 0.6 }}><ImportWizard /></div>
          </>
        )
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
