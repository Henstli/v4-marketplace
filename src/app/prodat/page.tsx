import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { Button, Price } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { getAllCards } from '@/lib/catalog';
import { getGame } from '@/lib/games';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';
import { deleteListing } from './actions';
import { ListingForm } from './ListingForm';
import styles from './sell.module.css';

export const metadata: Metadata = { title: 'Prodat karty' };

type Props = { searchParams: Promise<{ karta?: string }> };

export default async function SellPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) {
    return <ComingSoon title="Prodat karty" text="Vystavení karet zapneme po připojení databáze." />;
  }
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/prodat');

  const { karta } = await searchParams;
  const cards = await getAllCards();
  const bySlug = new Map(cards.map((c) => [c.id, c]));
  const options = cards
    .map((c) => ({ id: c.id, label: `${c.name} · ${c.setName} ${c.number} · ${getGame(c.game)?.name ?? ''}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'cs'));

  const supabase = await createClient();
  const { data: mine } = await supabase
    .from('listings')
    .select('id, card_id, price_czk, condition, language, quantity')
    .eq('seller_id', user.id)
    .order('created_at', { ascending: false });

  return (
    <div className={`container ${styles.page}`}>
      <div>
        <h1 className="t-heading-l">Prodat karty</h1>
        <p className="muted">Vystavujete jako {user.displayName}. Profil upravíte v <Link href="/ucet">nastavení účtu</Link>.</p>
      </div>

      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Nová nabídka</h2>
        <ListingForm cards={options} preselect={cards.find((c) => c.slug === karta)?.id} />
      </section>

      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Moje nabídky</h2>
        {mine?.length ? (
          <div className={styles.list}>
            {mine.map((l) => {
              const card = bySlug.get(l.card_id);
              return (
                <div key={l.id} className={styles.row}>
                  <div>
                    {card ? <Link href={`/karty/${card.slug}`} className={styles.rowName}>{card.name}</Link> : 'Karta'}
                    <div className="t-small muted">
                      <span className="code">{l.condition}</span> · {LANGUAGE_NAMES[l.language as Language] ?? l.language} · {l.quantity}&nbsp;ks
                    </div>
                  </div>
                  <Price amount={l.price_czk} />
                  <form action={deleteListing}>
                    <input type="hidden" name="id" value={l.id} />
                    <Button type="submit" variant="ghost">Stáhnout</Button>
                  </form>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">Zatím nic neprodáváte.</p>
        )}
      </section>
    </div>
  );
}
