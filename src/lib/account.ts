// Souhrn přihlášeného uživatele pro menu Můj profil a centrum účtu (jen na serveru).
import { cache } from 'react';
import { getCurrentUser } from './auth';
import { PLANS, type Plan } from './plans';
import { loyaltyLevel } from './profile-card';
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
  /** Člen týmu (správce i podpora) */
  isStaff: boolean;
  /** Prodeje čekající na potvrzení nebo odeslání */
  toShip: number;
  /** Nákupy potvrzené nebo odeslané, čekající na převzetí */
  toConfirm: number;
  /** Nepřečtená upozornění „na hlídanou kartu je nabídka“ */
  alerts: number;
  /** Aktivní nabídky (skladem) */
  listings: number;
  /** Otevřená hlášení, kterých se uživatel účastní */
  reports: number;
  /** Odznak věrnosti (jen s tarifem a když ho uživatel neskryl) */
  loyalty: { id: string; name: string } | null;
  /** Kolik věcí čeká na tým: otevřené případy podpory a (správce) karty ke schválení */
  teamWaiting: number;
}

export const getAccountSummary = cache(async (): Promise<AccountSummary | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const count = { count: 'exact' as const, head: true };
  const now = new Date().toISOString();
  const none = Promise.resolve({ count: 0 });
  const [profile, brands, ship, confirm, offers, draft, alerts, reports, loyal, prof, cases, cards] = await Promise.all([
    getShopProfile(user.id),
    getSellerBrands([user.id]),
    supabase.from('orders').select('id', count).eq('seller_id', user.id).in('status', ['requested', 'confirmed', 'paid']),
    supabase.from('orders').select('id', count).eq('buyer_id', user.id).in('status', ['confirmed', 'shipped']),
    supabase.from('listings').select('id', count).eq('seller_id', user.id).gt('quantity', 0),
    supabase.from('shop_page_drafts').select('user_id').eq('user_id', user.id).maybeSingle(),
    supabase.from('watch_alerts').select('id', count).eq('user_id', user.id).is('seen_at', null),
    supabase.from('reports').select('id', count).neq('status', 'closed').or(`reporter_id.eq.${user.id},against_id.eq.${user.id}`),
    supabase.rpc('seller_loyalty', { p_ids: [user.id] }),
    supabase.from('profiles').select('loyalty_hidden').eq('id', user.id).maybeSingle(),
    user.isStaff
      ? supabase.from('support_cases').select('id', count).eq('status', 'open').or(`snoozed_until.is.null,snoozed_until.lt.${now}`)
      : none,
    user.isAdmin ? supabase.from('card_submissions').select('id', count).eq('status', 'pending') : none,
  ]);
  const sub = ((loyal.data ?? []) as { plan: string; since: string }[])[0];
  const plan = profile?.plan ?? 'free';
  const kind = profile?.seller.kind ?? 'private';
  const b = brands.get(user.id);
  const shopPage = PLANS[plan].shopPage;
  const level = prof.data?.loyalty_hidden ? null : loyaltyLevel(plan, sub?.since ?? null);
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
    isStaff: user.isStaff,
    toShip: ship.count ?? 0,
    toConfirm: confirm.count ?? 0,
    listings: offers.count ?? 0,
    alerts: alerts.count ?? 0,
    reports: reports.count ?? 0,
    loyalty: level ? { id: level.id, name: level.name } : null,
    teamWaiting: (cases.count ?? 0) + (cards.count ?? 0),
  };
});
