import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSignedInUser } from '@/lib/auth';
import { PLANS } from '@/lib/plans';
import { shopHref } from '@/lib/shop-config';
import { getShopProfileBySlug, mediaUrl } from '@/lib/shop';
import { ShopPageView, type StockQuery } from './ShopPageView';

export type ShopRouteProps = { params: Promise<{ slug: string }>; searchParams: Promise<StockQuery> };

// Stránky /obchod/<slug> a /sberatel/<slug> jsou stejné, liší se jen druhem prodejce v adrese.
export async function shopMetadata({ params }: ShopRouteProps): Promise<Metadata> {
  const p = await getShopProfileBySlug((await params).slug);
  if (!p) return { title: 'Prodejce' };
  const logo = mediaUrl(p.config.logoPath);
  return {
    title: p.seller.name,
    description: p.config.tagline || p.config.about.slice(0, 160) || undefined,
    openGraph: logo ? { images: [logo] } : undefined,
    robots: p.config.published ? undefined : { index: false },
  };
}

export async function ShopRoute({ params, searchParams, kind }: ShopRouteProps & { kind: 'shop' | 'private' }) {
  const { slug } = await params;
  const p = await getShopProfileBySlug(slug);
  if (!p) notFound();
  // Bez tarifu s vlastní stránkou zůstává jen základní profil.
  if (!PLANS[p.plan].shopPage) redirect(`/prodejci/${p.seller.id}`);
  if (p.seller.kind !== kind) redirect(shopHref(p.seller.kind, slug));
  const user = await getSignedInUser();
  const owner = user?.id === p.seller.id;
  if (!p.config.published && !owner) notFound();
  return <ShopPageView p={p} query={await searchParams} preview={owner} />;
}
