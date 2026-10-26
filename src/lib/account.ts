// Souhrn přihlášeného uživatele pro menu Můj profil a centrum účtu (jen na serveru).
import { cache } from 'react';
import { getCurrentUser } from './auth';
import { PLANS, type Plan } from './plans';
import { getSellerBrands, getShopProfile } from './shop';
import { planColor, shopHref } from './shop-config';
import { createClient } from './supabase/server';

export interface AccountSummary {
  id: string;
  name: string;
  email: string;
  kind: 'shop' | 'private';
  plan: Plan;
  badge: boolean;
  logo: string | null;
  color: string;
  /** Veřejná stránka: vlastní (Plus, Pro, zveřejněná) nebo základní profil */
  href: string;
  /** Tarif dovoluje vlastní stránku */
  shopPage: boolean;
  published: boolean;
  /** Rozpracovaný koncept stránky v editoru */
  draft: boolean;
  isAdmin: boolean;
  /** Prodeje zaplacené a čekající na odeslání */
  toShip: number;
  /** Nákupy odeslané a čekající na potvrzení převzetí */
  toConfirm: number;
  /** Aktivní nabídky (skladem) */
  listings: number;
}

export const getAccountSummary = cache(async (): Promise<AccountSummary | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const count = { count: 'exact' as const, head: true };
  const [profile, brands, ship, confirm, offers, draft] = await Promise.all([
    getShopProfile(user.id),
    getSellerBrands([user.id]),
    supabase.from('orders').select('id', count).eq('seller_id', user.id).eq('status', 'paid'),
    supabase.from('orders').select('id', count).eq('buyer_id', user.id).eq('status', 'shipped'),
    supabase.from('listings').select('id', count).eq('seller_id', user.id).gt('quantity', 0),
    supabase.from('shop_page_drafts').select('user_id').eq('user_id', user.id).maybeSingle(),
  ]);
  const plan = profile?.plan ?? 'free';
  const kind = profile?.seller.kind ?? 'private';
  const b = brands.get(user.id);
  const shopPage = PLANS[plan].shopPage;
  const published = !!(b?.published && b.slug);
  return {
    id: user.id,
    name: profile?.seller.name ?? user.displayName,
    email: user.email,
    kind,
    plan,
    badge: profile?.badge ?? false,
    logo: b?.logo ?? null,
    color: planColor(b?.color ?? 'blue', plan),
    href: shopPage && published ? shopHref(kind, b!.slug!) : `/prodejci/${user.id}`,
    shopPage,
    published,
    draft: !!draft.data,
    isAdmin: user.isAdmin,
    toShip: ship.count ?? 0,
    toConfirm: confirm.count ?? 0,
    listings: offers.count ?? 0,
  };
});
