import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChipLink, initials } from '@/components/trezor';
import { CardSummaryTile } from '@/components/CardSummaryTile';
import { getSeller, PAGE_SIZE, searchCards } from '@/lib/catalog';
import { formatNumber, plural } from '@/lib/format';
import { PLANS } from '@/lib/plans';
import { shopHref } from '@/lib/shop-config';
import { getShopProfile, mediaUrl } from '@/lib/shop';
import styles from './seller.module.css';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ strana?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const seller = await getSeller((await params).id);
  return { title: seller ? seller.name : 'Prodejce' };
}

// Stránka prodejce nebo obchodu: kdo to je a všechny karty, které právě prodává.
export default async function SellerPage({ params, searchParams }: Props) {
  const { id } = await params;
  const seller = await getSeller(id);
  if (!seller) notFound();
  // Plus a Pro se zveřejněnou stránkou mají vlastní adresu, tahle vede tam.
  const shop = await getShopProfile(seller.id);
  if (shop && PLANS[shop.plan].shopPage && shop.saved.published && shop.saved.slug) redirect(shopHref(seller.kind, shop.saved.slug));
  const avatar = mediaUrl(shop?.saved.logoPath);
  const about = shop?.saved.about ?? '';
  const n = Number((await searchParams).strana);
  const page = Number.isInteger(n) && n > 1 ? n : 1;
  const { cards, total } = await searchCards({ sellerId: seller.id, page });
  const pages = Math.ceil(total / PAGE_SIZE);
  const pageHref = (p: number) => (p <= 1 ? `/prodejci/${seller.id}` : `/prodejci/${seller.id}?strana=${p}`);

  return (
    <div className={`container ${styles.page}`}>
      <section className={`panel ${styles.head}`}>
        <span className={styles.avatar} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {avatar ? <img src={avatar} alt="" /> : initials(seller.name)}
        </span>
        <div className={styles.headText}>
        <p className="t-label muted">{seller.kind === 'shop' ? 'OBCHOD' : 'SBĚRATEL'}</p>
        <h1 className="t-heading-l">{seller.name}</h1>
        <p className="muted">
          {seller.country === 'SK' ? 'Slovensko' : 'Česko'} ·{' '}
          {seller.rating != null
            ? <>{formatNumber(seller.rating, 1)}&nbsp;% kladných · {plural(seller.sales, ['hodnocení', 'hodnocení', 'hodnocení'])}</>
            : 'Zatím bez hodnocení'}
          {' · '}{plural(total, ['karta v nabídce', 'karty v nabídce', 'karet v nabídce'])}
        </p>
        {about ? <p className={styles.about}>{about}</p> : null}
        </div>
      </section>

      {cards.length ? (
        <>
          <div className="card-grid">
            {cards.map((card) => <CardSummaryTile key={card.id} card={card} />)}
          </div>
          {pages > 1 ? (
            <nav className={styles.pager} aria-label="Stránky">
              {page > 1 ? <ChipLink href={pageHref(page - 1)}>← Předchozí</ChipLink> : null}
              <span className="t-small muted">Strana {page} z {formatNumber(pages)}</span>
              {page < pages ? <ChipLink href={pageHref(page + 1)}>Další →</ChipLink> : null}
            </nav>
          ) : null}
        </>
      ) : (
        <div className="panel">
          <h2 className="t-heading-m">Teď nic neprodává</h2>
          <p className="muted">Podívejte se do <Link href="/karty">katalogu</Link> na nabídky ostatních prodejců.</p>
        </div>
      )}
    </div>
  );
}
