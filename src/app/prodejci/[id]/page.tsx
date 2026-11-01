import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChipLink, ProfileCard } from '@/components/trezor';
import { CardSummaryTile } from '@/components/CardSummaryTile';
import { MessageSeller } from '@/components/shop/ShopClient';
import { SellerTrust } from '@/components/shop/SellerTrust';
import { ReportContent } from '@/components/reports/ReportContent';
import { getCurrentUser } from '@/lib/auth';
import { getSeller, PAGE_SIZE, searchCards } from '@/lib/catalog';
import { formatNumber, plural } from '@/lib/format';
import { PLANS } from '@/lib/plans';
import { getProfileCard } from '@/lib/profile';
import { shopHref } from '@/lib/shop-config';
import { getShopProfile } from '@/lib/shop';
import styles from './seller.module.css';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ strana?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const seller = await getSeller((await params).id);
  return { title: seller ? seller.name : 'Profil' };
}

function months(m: number) {
  return m >= 12 ? plural(Math.floor(m / 12), ['rok', 'roky', 'let']) : plural(m, ['měsíc', 'měsíce', 'měsíců']);
}

// Profil každého uživatele na hrací podložce (DS Trezor › ProfileMat, rozložení B):
// vlevo karta profilu a rychlé statistiky, vpravo poslední obchody, pod tím nabídky.
export default async function SellerPage({ params, searchParams }: Props) {
  const { id } = await params;
  const [seller, card] = await Promise.all([getSeller(id), getProfileCard(id)]);
  if (!seller || !card) notFound();
  const shop = await getShopProfile(seller.id);
  const shopLink = shop && PLANS[shop.plan].shopPage && shop.saved.published && shop.saved.slug ? shopHref(seller.kind, shop.saved.slug) : null;
  const n = Number((await searchParams).strana);
  const page = Number.isInteger(n) && n > 1 ? n : 1;
  const [{ cards, total }, viewer] = await Promise.all([searchCards({ sellerId: seller.id, page }), getCurrentUser()]);
  const pages = Math.ceil(total / PAGE_SIZE);
  const pageHref = (p: number) => (p <= 1 ? `/prodejci/${seller.id}` : `/prodejci/${seller.id}?strana=${p}`);
  const own = viewer?.id === seller.id;

  return (
    <div className={`container ${styles.page}`}>
      <section className="tz-mat" aria-label={`Profil ${seller.name}`}>
        <div className="tz-mat-grid">
          <div className="tz-mat-left">
            <ProfileCard data={card} headingLevel={1} />
            <div className="tz-mat-stats">
              <div className="tz-mat-stat"><b>{card.memberYear ?? '–'}</b><span>Členem od</span></div>
              <div className="tz-mat-stat"><b>{PLANS[card.plan].name}</b><span>Tarif</span></div>
              <div className="tz-mat-stat"><b>{card.loyalty ? months(card.loyalty.months) : '–'}</b><span>{card.loyalty ? `Věrnost · ${card.loyalty.name}` : 'Věrnost'}</span></div>
            </div>
            <div className="tz-mat-actions">
              {own ? (
                <Link href="/ucet/vzhled" className="tz-btn tz-btn-md tz-btn-primary">Upravit vzhled profilu</Link>
              ) : (
                <>
                  <MessageSeller sellerId={seller.id} />
                  {shopLink ? <Link href={shopLink} className="tz-btn tz-btn-md tz-btn-secondary">{seller.kind === 'shop' ? 'Obchod' : 'Stránka'}</Link> : null}
                </>
              )}
            </div>
            {!own ? <ReportContent kind="seller" target={seller.id} variant="menu" preview={{ title: seller.name }} /> : null}
          </div>
          <div className="tz-mat-right">
            <section className="tz-mat-panel" aria-labelledby="posledni-obchody">
              <h2 id="posledni-obchody" className="t-heading-m">Poslední obchody</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                {seller.rating != null
                  ? <>{formatNumber(seller.rating, 1)}&nbsp;% kladných z {plural(seller.sales, ['hodnocení', 'hodnocení', 'hodnocení'])}.</>
                  : 'Zatím bez hodnocení.'}
              </p>
              <SellerTrust sellerId={seller.id} />
            </section>
          </div>
        </div>
      </section>

      <h2 className="t-heading-m" style={{ margin: 0 }}>Nabídka · {plural(total, ['karta', 'karty', 'karet'])}</h2>
      {cards.length ? (
        <>
          <div className="card-grid">
            {cards.map((c) => <CardSummaryTile key={c.id} card={c} />)}
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
