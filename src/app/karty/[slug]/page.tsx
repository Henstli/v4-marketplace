import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { ButtonLink, Price, SellerBadge, ShopLogo, shopStyle, Status, Trend } from '@/components/trezor';
import { PriceChart } from '@/components/PriceChart';
import { AddToCartButton } from '@/components/cart/AddToCartButton';
import { WatchButton } from '@/components/WatchButton';
import { ProposePrice } from '@/components/offers/ProposePrice';
import { getCardBySlug, getOffers, getReservedOffers, type Offer, type ReservedOffer } from '@/lib/catalog';
import type { CardSummary } from '@/lib/types';
import { getGame } from '@/lib/games';
import { formatDateTime, formatNumber } from '@/lib/format';
import { getOfferBrands, sortOffers } from '@/lib/shop';
import { safeColor } from '@/lib/shop-config';
import { CONDITION_NAMES, LANGUAGE_NAMES } from '@/lib/types';
import styles from './detail.module.css';

type Props = { params: Promise<{ slug: string }> };

// Detail karty jde z mezipaměti a obnoví se nejpozději po minutě; nová nebo prodaná nabídka ho obnoví
// hned (revalidatePath('/karty', 'layout') v akcích). Žádné stránky se nepředgenerují při sestavení.
export const revalidate = 60;
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = await getCardBySlug((await params).slug);
  return card ? { title: `${card.name} · ${card.setName}` } : {};
}

export default async function CardDetailPage({ params }: Props) {
  const card = await getCardBySlug((await params).slug);
  if (!card) notFound();
  const [unsorted, reservedUnsorted] = await Promise.all([getOffers(card.id), getReservedOffers(card.id)]);
  const brands = await getOfferBrands([...unsorted, ...reservedUnsorted].map((o) => o.seller));
  const offers = sortOffers(unsorted, brands);
  // Rezervované (čekají na potvrzení prodejce) jsou pod volnými, místo košíku jde na ně čekat.
  const reserved = sortOffers(reservedUnsorted, brands);
  const rows: Array<Offer | ReservedOffer> = [...offers, ...reserved];
  // „Přidat nejlevnější“ jen z nabídek s pevnou cenou (cena dohodou do košíku nejde).
  const cheapest = offers.find((o) => o.price != null);
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
        <div
          className={card.image ? `${styles.art} ${styles.artPhoto}` : styles.art}
          style={card.image ? undefined : { background: `var(--game-${card.game}-art, var(--surface-sunken))` }}
        >
          {card.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.image} alt={`${card.name}, ${card.setName} ${card.number}`} className="tz-tile-img" />
          ) : (
            <div className="tz-tile-frame">{game?.label}</div>
          )}
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
              {cheapest?.price != null ? (
                <AddToCartButton item={cartItem(card, cheapest, cheapest.price)} label="Přidat nejlevnější do košíku" variant="primary" size="lg" />
              ) : (
                <WatchButton cardId={card.id} />
              )}
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
          <p className="t-small muted">Seřazeno od nejlevnější, při stejné ceně od nejlepšího stavu</p>
        </div>
        {rows.length ? (
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
                {rows.map((o, i) => {
                  const reserved = 'reservedUntil' in o;
                  return (
                  <Fragment key={o.id}>
                  {/* Rezervované jsou oddělené a ztlumené: objednat nejdou, jde jen čekat. */}
                  {reserved && (i === 0 || !('reservedUntil' in rows[i - 1])) ? (
                    <tr className={styles.groupRow}>
                      <td colSpan={6}>
                        <strong>Rezervované</strong> Čekají na potvrzení prodejce, objednat teď nejdou. Klikněte na Čekat a dáme vám vědět, až se uvolní.
                      </td>
                    </tr>
                  ) : null}
                  <tr className={reserved ? styles.reserved : undefined}>
                    <td>
                      {(() => {
                        const b = brands.get(o.seller.id);
                        const pro = b?.plan === 'pro';
                        return (
                          <div className={styles.sellerCell}>
                            {b && b.plan !== 'free' ? (
                              <span style={shopStyle(safeColor(b.color))}>
                                <ShopLogo name={o.seller.name} image={b.logo} size={pro ? 44 : 32} />
                              </span>
                            ) : null}
                            <div className={styles.sellerText}>
                              <div className={styles.sellerName}>
                                <Link href={b?.href ?? `/prodejci/${o.seller.id}`} className={styles.seller}>{o.seller.name}</Link>
                                {b?.badge ? <SellerBadge type="verified" /> : null}
                                {pro ? <SellerBadge type="pro" /> : null}
                              </div>
                              {b?.note ? <div className="t-small">{b.note}</div> : null}
                              <div className="t-small muted">
                                {o.seller.kind === 'shop' ? 'Obchod' : 'Sběratel · soukromý prodejce'} · {o.seller.country} ·{' '}
                                {o.seller.rating != null ? <>{formatNumber(o.seller.rating, 1)}&nbsp;% kladných · {formatNumber(o.seller.sales)} hodnocení</> : 'Zatím bez hodnocení'}
                              </div>
                              {'reservedUntil' in o ? (
                                <Status tone="warn" className={styles.reservedTag}>
                                  Rezervováno{o.reservedUntil ? ` do ${formatDateTime(o.reservedUntil)}` : ''}
                                </Status>
                              ) : null}
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <span className="code" title={CONDITION_NAMES[o.condition]}>{o.condition}</span>
                      {o.graded ? <> <span className="code">{o.graded}</span></> : null}
                    </td>
                    <td className={styles.wide}>{LANGUAGE_NAMES[o.language]}</td>
                    <td className={`${styles.num} ${styles.wide} t-price`}>{o.quantity}</td>
                    <td className={styles.num}>{o.price != null ? <Price amount={o.price} /> : <span className="muted">Dohodou</span>}</td>
                    <td className={styles.num}>
                      <div className={styles.actions}>
                        {/* Dotaz k nabídce: konverzace s prodejcem s odkazem na tuto nabídku. */}
                        <ButtonLink
                          href={`/zpravy/${o.seller.id}?nabidka=${o.id}`}
                          variant="secondary"
                          className={styles.ask}
                          title={`Napsat prodejci ${o.seller.name}`}
                          aria-label={`Napsat prodejci ${o.seller.name} k této nabídce`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
                          </svg>
                          <span className={styles.askText}>Napsat</span>
                        </ButtonLink>
                        {'reservedUntil' in o ? <WatchButton cardId={card.id} size="md" compact />
                          : o.price == null ? <ProposePrice listingId={o.id} sellerId={o.seller.id} max={o.quantity} />
                          : <AddToCartButton item={cartItem(card, o, o.price)} />}
                      </div>
                    </td>
                  </tr>
                  </Fragment>
                  );
                })}
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

function cartItem(card: CardSummary, o: Offer, price: number) {
  return {
    listingId: o.id,
    cardSlug: card.slug,
    cardName: card.name,
    setLabel: `${card.setCode} ${card.number}`,
    sellerId: o.seller.id,
    sellerName: o.seller.name,
    condition: o.condition + (o.graded ? ` · ${o.graded}` : ''),
    language: LANGUAGE_NAMES[o.language],
    price,
    maxQuantity: o.quantity,
    image: card.image,
    game: card.game,
  };
}
