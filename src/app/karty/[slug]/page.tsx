import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ButtonLink, Price, Trend } from '@/components/trezor';
import { PriceChart } from '@/components/PriceChart';
import { AddToCartButton } from '@/components/cart/AddToCartButton';
import { getCardBySlug, getOffers, type Offer } from '@/lib/catalog';
import type { CardSummary } from '@/lib/types';
import { getGame } from '@/lib/games';
import { formatNumber } from '@/lib/format';
import { CONDITION_NAMES, LANGUAGE_NAMES } from '@/lib/types';
import styles from './detail.module.css';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = await getCardBySlug((await params).slug);
  return card ? { title: `${card.name} · ${card.setName}` } : {};
}

export default async function CardDetailPage({ params }: Props) {
  const card = await getCardBySlug((await params).slug);
  if (!card) notFound();
  const offers = await getOffers(card.id);
  const game = getGame(card.game);
  const avg = card.priceHistory.length
    ? Math.round(card.priceHistory.reduce((a, b) => a + b, 0) / card.priceHistory.length)
    : null;

  return (
    <div className="container">
      <nav className={`t-small muted ${styles.crumbs}`} aria-label="Drobečková navigace">
        <Link href="/karty">Karty</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/karty?hra=${card.game}`}>{game?.name}</Link>
        <span aria-hidden="true">/</span>
        <span>{card.name}</span>
      </nav>

      <div className={styles.top}>
        <div className={styles.art} style={{ background: `var(--game-${card.game}-art, var(--surface-sunken))` }}>
          <div className="tz-tile-frame">{game?.label}</div>
        </div>

        <div className={styles.info}>
          <p className="t-label muted">{game?.name.toUpperCase()}</p>
          <h1 className="t-display-l">{card.name}</h1>
          <p className="muted">
            {card.setName} · <span className="code">{card.setCode} {card.number}</span> · {card.rarity}
          </p>

          <div className={`panel ${styles.buy}`}>
            <div className={styles.buyRow}>
              <div>
                <p className="t-small muted">Nejnižší cena</p>
                {card.minPrice != null ? <Price amount={card.minPrice} size="lg" /> : <p className="t-price-l">Bez nabídek</p>}
              </div>
              <Trend value={card.trend} pill suffix="za 30 dní" />
            </div>
            <dl className={styles.facts}>
              <div><dt className="t-small muted">Nabídek</dt><dd className="t-price">{offers.length}</dd></div>
              <div><dt className="t-small muted">Průměr 30 dní</dt><dd className="t-price">{avg != null ? <>{formatNumber(avg)}&nbsp;Kč</> : 'Bez prodejů'}</dd></div>
            </dl>
            <div className={styles.buyActions}>
              {offers.length ? (
                <AddToCartButton item={cartItem(card, offers[0])} label="Přidat nejlevnější do košíku" variant="primary" size="lg" />
              ) : null}
              <ButtonLink href={`/prodat?karta=${card.slug}`} size="lg" variant="secondary">Prodat tuto kartu</ButtonLink>
            </div>
          </div>
        </div>
      </div>

      <section className={`panel ${styles.chart}`}>
        <div className="section-head">
          <h2 className="t-heading-m">Vývoj ceny</h2>
          <p className="t-small muted">Plná čára: průměrná prodejní cena za den · přerušovaná: průměr 30 dní</p>
        </div>
        <PriceChart
          values={card.priceHistory}
          label={`Cena za 30 dní se změnila o ${formatNumber(card.trend, 1)} %, průměr ${formatNumber(avg ?? 0)} Kč`}
        />
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="t-heading-l">Nabídky</h2>
          <p className="t-small muted">Seřazeno od nejlevnější</p>
        </div>
        {offers.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Prodejce</th>
                  <th>Stav</th>
                  <th className={styles.wide}>Jazyk</th>
                  <th className={`${styles.num} ${styles.wide}`}>Kusů</th>
                  <th className={styles.num}>Cena</th>
                  <th><span className="sr-only">Akce</span></th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <div className={styles.seller}>{o.seller.name}</div>
                      <div className="t-small muted">
                        {o.seller.kind === 'shop' ? 'Obchod' : 'Sběratel'} · {o.seller.country} ·{' '}
                        {o.seller.rating != null ? <>{formatNumber(o.seller.rating, 1)}&nbsp;% kladných · {formatNumber(o.seller.sales)} hodnocení</> : 'Zatím bez hodnocení'}
                      </div>
                    </td>
                    <td>
                      <span className="code" title={CONDITION_NAMES[o.condition]}>{o.condition}</span>
                      {o.graded ? <> <span className="code">{o.graded}</span></> : null}
                    </td>
                    <td className={styles.wide}>{LANGUAGE_NAMES[o.language]}</td>
                    <td className={`${styles.num} ${styles.wide} t-price`}>{o.quantity}</td>
                    <td className={styles.num}><Price amount={o.price} /></td>
                    <td className={styles.num}>
                      <AddToCartButton item={cartItem(card, o)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel">
            <p className="muted">Tuto kartu zatím nikdo neprodává.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function cartItem(card: CardSummary, o: Offer) {
  return {
    listingId: o.id,
    cardSlug: card.slug,
    cardName: card.name,
    setLabel: `${card.setCode} ${card.number}`,
    sellerId: o.seller.id,
    sellerName: o.seller.name,
    condition: o.condition + (o.graded ? ` · ${o.graded}` : ''),
    language: LANGUAGE_NAMES[o.language],
    price: o.price,
    maxQuantity: o.quantity,
  };
}
