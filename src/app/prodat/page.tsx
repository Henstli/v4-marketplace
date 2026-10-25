import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { Button, ButtonLink, Price, SearchField } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { getCardBySlug, searchCards } from '@/lib/catalog';
import { getGame } from '@/lib/games';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';
import { deleteListing } from './actions';
import { ListingForm } from './ListingForm';
import styles from './sell.module.css';

export const metadata: Metadata = { title: 'Prodat karty' };

type Props = { searchParams: Promise<{ karta?: string; hledat?: string }> };

export default async function SellPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) {
    return <ComingSoon title="Prodat karty" text="Vystavení karet zapneme po připojení databáze." />;
  }
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/prodat');

  const { karta, hledat } = await searchParams;
  const q = hledat?.trim();
  const [selected, found] = await Promise.all([
    karta ? getCardBySlug(karta) : null,
    q ? searchCards({ q, pageSize: 12 }) : null,
  ]);

  const supabase = await createClient();
  const { data: mine } = await supabase
    .from('listings')
    .select('id, price_czk, condition, language, quantity, cards(slug, name)')
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
        {selected ? (
          <>
            <div className={styles.picked}>
              <div>
                <p className="t-label muted">KARTA</p>
                <Link href={`/karty/${selected.slug}`} className={styles.rowName}>{selected.name}</Link>
                <div className="t-small muted">
                  {selected.setName} · <span className="code">{selected.setCode} {selected.number}</span> · {getGame(selected.game)?.name}
                </div>
              </div>
              <ButtonLink href="/prodat" variant="ghost">Změnit kartu</ButtonLink>
            </div>
            <ListingForm cardId={selected.id} />
          </>
        ) : (
          <>
            <form action="/prodat" className={styles.search}>
              <SearchField name="hledat" defaultValue={q} placeholder="Název karty, sada nebo číslo" label="Najít kartu v katalogu" />
            </form>
            {found ? (
              found.cards.length ? (
                <div className={styles.list}>
                  {found.cards.map((c) => (
                    <Link key={c.id} href={`/prodat?karta=${c.slug}`} className={styles.result}>
                      <span className={styles.rowName}>{c.name}</span>
                      <span className="t-small muted">
                        {c.setName} · <span className="code">{c.setCode} {c.number}</span> · {getGame(c.game)?.name}
                      </span>
                    </Link>
                  ))}
                  {found.total > found.cards.length ? (
                    <p className="t-small muted">Zobrazeno {found.cards.length} z {found.total}. Upřesněte hledání, třeba přidejte sadu nebo číslo karty.</p>
                  ) : null}
                </div>
              ) : (
                <p className="muted">Kartu jsme v katalogu nenašli. Zkuste jiný název nebo číslo.</p>
              )
            ) : (
              <p className="t-small muted">Napište název karty a vyberte ji z výsledků.</p>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Moje nabídky</h2>
        {mine?.length ? (
          <div className={styles.list}>
            {mine.map((l) => {
              const card = (Array.isArray(l.cards) ? l.cards[0] : l.cards) as { slug: string; name: string } | null;
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
