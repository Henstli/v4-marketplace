import Link from 'next/link';
import { ButtonLink, Price, SellerBadge, ShopLogo, shopStyle, Sparkline, Trend } from '@/components/trezor';
import { CardSummaryTile } from '@/components/CardSummaryTile';
import { getStats, getTrending } from '@/lib/catalog';
import { GAMES } from '@/lib/games';
import { formatNumber, plural } from '@/lib/format';
import { getProShops } from '@/lib/shop';
import { safeColor, shopHref } from '@/lib/shop-config';
import styles from './home.module.css';

// Úvodní stránka je pro všechny stejná, z mezipaměti se obnoví nejpozději po minutě.
export const revalidate = 60;

export default async function HomePage() {
  const [trending, stats, proShops] = await Promise.all([getTrending(8), getStats(), getProShops(6)]);
  const top = trending[0];

  return (
    <>
      <section className={`container ${styles.hero}`}>
        <div className={styles.heroText}>
          <p className="t-label muted">SBĚRATELSKÉ KARTY · CZ A SK</p>
          <h1 className="t-display-xl">Kupujte karty s přehledem</h1>
          <p className="t-body-l muted">
            Pokémon, Magic a sportovní karty od ověřených obchodů i sběratelů. Vidíte vývoj ceny, objednáte od více
            prodejců v jednom košíku a platíte přímo jim.
          </p>
          <div className={styles.heroActions}>
            <ButtonLink href="/karty" size="lg">Procházet karty</ButtonLink>
            <ButtonLink href="/prodat" size="lg" variant="secondary">Začít prodávat</ButtonLink>
          </div>
          <dl className={styles.stats}>
            <div><dt className="t-small muted">Karet v katalogu</dt><dd className="t-price-l">{formatNumber(stats.cards)}</dd></div>
            <div><dt className="t-small muted">Nabídek</dt><dd className="t-price-l">{formatNumber(stats.offers)}</dd></div>
            <div><dt className="t-small muted">Prodejců</dt><dd className="t-price-l">{formatNumber(stats.sellers)}</dd></div>
          </dl>
        </div>

        {top ? (
          <Link href={`/karty/${top.slug}`} className={`panel ${styles.heroPanel}`}>
            <p className="t-label muted">NEJVĚTŠÍ RŮST ZA 30 DNÍ</p>
            <h2 className="t-heading-l">{top.name}</h2>
            <p className="t-small muted">{top.setName} · <span className="code">{top.setCode} {top.number}</span></p>
            <div className={styles.heroPrice}>
              <Price amount={top.minPrice ?? 0} prefix="od" size="lg" />
              <Trend value={top.trend} pill suffix="za 30 dní" />
            </div>
            <Sparkline
              values={top.priceHistory}
              width={420}
              height={120}
              area
              strokeWidth={2.5}
              label={`Cena za 30 dní se změnila o ${formatNumber(top.trend, 1)} %`}
            />
          </Link>
        ) : null}
      </section>

      <section className="container section">
        <div className="section-head">
          <h2 className="t-heading-l">Nejvíc rostou tento týden</h2>
          <Link href="/karty?razeni=trend" className="t-small muted">Zobrazit vše</Link>
        </div>
        <div className="card-grid">
          {trending.map((card) => <CardSummaryTile key={card.id} card={card} />)}
        </div>
      </section>

      {proShops.length ? (
        <section className="container section">
          <div className="section-head">
            <h2 className="t-heading-l">Obchody Pro</h2>
            <span className="t-small muted">Prodejci s tarifem Pro, pořadí se střídá</span>
          </div>
          <div className={styles.shops}>
            {proShops.map((s) => (
              <Link key={s.id} href={shopHref(s.kind, s.slug)} className={`tz-shop ${styles.shop}`} style={shopStyle(safeColor(s.color))}>
                <ShopLogo name={s.name} image={s.logo} size={56} />
                <span className={styles.shopText}>
                  <span className={styles.shopName}><span className="t-heading-m">{s.name}</span><SellerBadge type="pro" /></span>
                  {s.tagline ? <span className="t-small muted">{s.tagline}</span> : null}
                  <span className="t-small muted">{plural(s.offers, ['karta v nabídce', 'karty v nabídce', 'karet v nabídce'])}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="container section">
        <h2 className="t-heading-l" style={{ marginBottom: 'var(--space-6)' }}>Kategorie</h2>
        <div className={styles.games}>
          {GAMES.map((g) =>
            g.live ? (
              <Link key={g.id} href={`/karty?hra=${g.id}`} className={styles.game}>
                <span className={styles.gameDot} style={{ background: g.dot }} aria-hidden="true" />
                <span className="t-heading-m">{g.name}</span>
              </Link>
            ) : (
              <div key={g.id} className={`${styles.game} ${styles.gameSoon}`}>
                <span className={styles.gameDot} style={{ background: g.dot }} aria-hidden="true" />
                <span className="t-heading-m">{g.name}</span>
                <span className="t-small muted">Připravujeme</span>
              </div>
            ),
          )}
        </div>
      </section>

      <section className="container section">
        <div className={styles.trust}>
          <div className="panel">
            <h3 className="t-heading-m">Rezervace do potvrzení</h3>
            <p className="muted">Po objednání prodejce do 48 hodin potvrdí, že kartu má. Do té doby ji nikdo jiný nekoupí.</p>
          </div>
          <div className="panel">
            <h3 className="t-heading-m">Ověření prodejci</h3>
            <p className="muted">Obchody i soukromí prodejci mají hodnocení z dokončených objednávek, ne z anonymních recenzí.</p>
          </div>
          <div className="panel">
            <h3 className="t-heading-m">Doprava po Česku a Slovensku</h3>
            <p className="muted">Zásilkovna, Balíkovna nebo osobní předání, jak se s prodejcem domluvíte. Platíte převodem přímo prodejci.</p>
          </div>
        </div>
      </section>
    </>
  );
}
