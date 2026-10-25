import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { ButtonLink, CardThumb } from '@/components/trezor';
import { SearchBox } from '@/components/search/SearchBox';
import { getCurrentUser } from '@/lib/auth';
import { getCardBySlug, searchCards } from '@/lib/catalog';
import { getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { formatNumber } from '@/lib/format';
import { ListingForm } from './ListingForm';
import { StockTable, type StockItem } from './StockTable';
import styles from './sell.module.css';

export const metadata: Metadata = { title: 'Prodat karty' };

type CardRow = {
  slug: string; name: string; number: string; image_url: string | null; game_id: string | null;
  card_sets: { code: string; name: string } | { code: string; name: string }[] | null;
};

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
  // Supabase vrací nejvýš 1000 řádků na dotaz, velký sklad obchodu čteme po stránkách.
  const mine = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data } = await supabase
      .from('listings')
      .select('id, price_czk, condition, language, quantity, cards(slug, name, number, image_url, game_id, card_sets(code, name))')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + 999);
    mine.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  const stock: StockItem[] = mine.map((l) => {
    const card = one(l.cards as unknown as CardRow | CardRow[] | null);
    const set = one(card?.card_sets);
    return {
      id: l.id,
      price: l.price_czk,
      condition: l.condition,
      language: l.language,
      quantity: l.quantity,
      card: card
        ? { slug: card.slug, name: card.name, number: card.number, image: card.image_url, game: card.game_id, setCode: set?.code ?? '', setName: set?.name ?? '' }
        : null,
    };
  });

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
              <CardThumb size="lg" image={thumbUrl(selected.image)} preview={selected.image} color={`var(--game-${selected.game}-art)`} />
              <div className={styles.grow}>
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
            <SearchBox
              key={q ?? ''}
              className={styles.search}
              action="/prodat"
              param="hledat"
              cardHref="/prodat?karta="
              defaultValue={q}
              placeholder="Název karty, sada nebo číslo"
              label="Najít kartu v katalogu"
            />
            {found ? (
              found.cards.length ? (
                <div className={styles.list}>
                  {found.cards.map((c) => (
                    <Link key={c.id} href={`/prodat?karta=${c.slug}`} className={styles.result}>
                      <CardThumb image={thumbUrl(c.image)} preview={c.image} color={`var(--game-${c.game}-art)`} />
                      <span className={styles.resultText}>
                        <span className={styles.rowName}>{c.name}</span>
                        <span className="t-small muted">
                          {c.setName} · <span className="code">{c.setCode} {c.number}</span> · {getGame(c.game)?.name}
                        </span>
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
            <p className={`t-small muted ${styles.suggest}`}>
              Hokejovou nebo jinou sportovní kartu v katalogu nenajdete? <Link href="/prodat/nova-karta">Navrhněte ji</Link> a my ji po schválení přidáme.
            </p>
          </>
        )}
      </section>

      <section className="panel" id="moje-nabidky">
        <div className={styles.sectionHead}>
          <h2 className="t-heading-m">Moje nabídky{stock.length ? ` (${formatNumber(stock.length)})` : ''}</h2>
          <div className={styles.headActions}>
            <ButtonLink href="/prodat/import" variant="secondary">Hromadně nahrát</ButtonLink>
            {stock.length ? <a href="/prodat/export" className="tz-btn tz-btn-ghost tz-btn-md" download>Exportovat sklad (CSV)</a> : null}
          </div>
        </div>
        {stock.length ? (
          <StockTable items={stock} />
        ) : (
          <p className="muted">
            Zatím nic neprodáváte. Vystavte kartu výše, nebo <Link href="/prodat/import">nahrajte celý sklad z tabulky</Link> (CSV, Excel, export z Cardmarketu).
          </p>
        )}
      </section>
    </div>
  );
}
