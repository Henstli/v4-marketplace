import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { WantsView, type Want } from '@/app/prodat/Wants';
import { getCurrentUser } from '@/lib/auth';
import { PageTabs } from '@/components/account/PageTabs';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Hlídání a příkazy' };

/** Hlídané karty: jeden seznam (dřív Hledám ve Sbírce a Čekám na) s nejvyšší cenou a nejhorším stavem. */
export default async function WatchedPage() {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/ucet/hlidane');
  const supabase = await createClient();
  const { data } = await supabase.rpc('watch_view');
  const wants: Want[] = ((data ?? []) as Record<string, never>[]).map((w) => ({
    cardId: w.card_id, slug: w.slug, name: w.name, number: w.number, image: w.image_url, game: w.game_id,
    setCode: w.set_code ?? '', setName: w.set_name ?? '', maxPrice: w.max_price_czk, minCondition: w.min_condition,
    low: w.low_czk, offers: w.offers, fresh: w.fresh,
  }));
  // Zobrazená upozornění se označí jako přečtená (zmizí tečka v menu). Štítek Nové je vidět ještě teď.
  if (wants.some((w) => w.fresh)) await supabase.from('watch_alerts').update({ seen_at: new Date().toISOString() }).eq('user_id', user.id).is('seen_at', null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 className="t-heading-l">Hlídání a příkazy</h1>
        <PageTabs label="Hlídání a příkazy" current="/ucet/hlidane" tabs={[{ label: 'Hlídané karty', href: '/ucet/hlidane' }, { label: 'Příkazy' }]} />
      </div>
      <div className="tz-sk"><WantsView wants={wants} /></div>
    </div>
  );
}
