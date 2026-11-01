import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChipLink } from '@/components/trezor';
import { ProfileMat } from '@/components/profile/ProfileMat';
import { CardSummaryTile } from '@/components/CardSummaryTile';
import { SellerTrust } from '@/components/shop/SellerTrust';
import { ReportContent } from '@/components/reports/ReportContent';
import { FriendButton } from '@/components/profile/FriendButton';
import { getAccountSummary } from '@/lib/account';
import { getCurrentUser } from '@/lib/auth';
import { getSeller, PAGE_SIZE, searchCards } from '@/lib/catalog';
import { formatNumber, plural } from '@/lib/format';
import { PLANS } from '@/lib/plans';
import { getFriendStatus, getProfileFriends } from '@/lib/friends';
import { getProfileCard, getProfileShowcase } from '@/lib/profile';
import { shopHref } from '@/lib/shop-config';
import { getShopProfile } from '@/lib/shop';
import styles from './seller.module.css';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ strana?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const seller = await getSeller((await params).id);
  return { title: seller ? seller.name : 'Profil' };
}

// Profil každého uživatele na hrací podložce (DS Trezor › ProfileMat, deska P5, rozvržení B Karta vlevo):
// karta se statistikami, Alba, Chybí do sady, Poslední obchody a přátelé; pod podložkou spolehlivost a nabídky.
export default async function SellerPage({ params, searchParams }: Props) {
  const { id } = await params;
  const [seller, card, show] = await Promise.all([getSeller(id), getProfileCard(id), getProfileShowcase(id)]);
  if (!seller || !card) notFound();
  const shop = await getShopProfile(seller.id);
  const shopLink = shop && PLANS[shop.plan].shopPage && shop.saved.published && shop.saved.slug ? shopHref(seller.kind, shop.saved.slug) : null;
  const n = Number((await searchParams).strana);
  const page = Number.isInteger(n) && n > 1 ? n : 1;
  const [{ cards, total }, viewer] = await Promise.all([searchCards({ sellerId: seller.id, page }), getCurrentUser()]);
  const pages = Math.ceil(total / PAGE_SIZE);
  const pageHref = (p: number) => (p <= 1 ? `/prodejci/${seller.id}` : `/prodejci/${seller.id}?strana=${p}`);
  const own = viewer?.id === seller.id;
  const requests = own ? (await getAccountSummary())?.friendRequests ?? 0 : 0;
  const [friends, status] = viewer ? await Promise.all([getProfileFriends(seller.id), own ? 'none' as const : getFriendStatus(seller.id)]) : [[], 'none' as const];

  const actions = own ? (
    <>
      <Link href="/ucet/vzhled" className="tz-btn tz-btn-md tz-btn-primary">Upravit vzhled profilu</Link>
      <Link href="/kolekce" className="tz-btn tz-btn-md tz-mat-ghost">Moje kolekce</Link>
      <Link href="/zpravy?pratele" className="tz-btn tz-btn-md tz-mat-ghost">Přátelé{requests ? <span className="tz-acct-count" aria-label={`${requests} nové žádosti`}>{requests}</span> : null}</Link>
    </>
  ) : (
    <>
      {shopLink ? <Link href={shopLink} className="tz-btn tz-btn-md tz-btn-primary">{seller.kind === 'shop' ? 'Obchod' : 'Stránka'}</Link> : null}
      <Link href={`/zpravy/${seller.id}`} className="tz-btn tz-btn-md tz-btn-orange">Napsat</Link>
      <FriendButton other={seller.id} initial={status} signedIn={!!viewer} />
    </>
  );

  return (
    <div className={`container ${styles.page}`}>
      <ProfileMat card={card} show={show} own={own} actions={actions} friends={friends} signedIn={!!viewer}
        more={own ? undefined : <ReportContent kind="seller" target={seller.id} variant="menu" preview={{ title: seller.name }} />} />

      {seller.rating != null || seller.sales ? (
        <section className="panel" aria-labelledby="spolehlivost">
          <h2 id="spolehlivost" className="t-heading-m">Spolehlivost</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {seller.rating != null
              ? <>{formatNumber(seller.rating, 1)}&nbsp;% kladných z {plural(seller.sales, ['hodnocení', 'hodnocení', 'hodnocení'])}.</>
              : 'Zatím bez hodnocení.'}
          </p>
          <SellerTrust sellerId={seller.id} />
        </section>
      ) : null}

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
