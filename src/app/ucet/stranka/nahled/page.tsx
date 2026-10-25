import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { PLANS } from '@/lib/plans';
import { effectiveConfig, sanitizeConfig } from '@/lib/shop-config';
import { getShopProfile } from '@/lib/shop';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { ShopPageView, type StockQuery } from '@/components/shop/ShopPageView';

export const metadata: Metadata = { title: 'Náhled stránky', robots: { index: false } };

// Živý náhled v editoru: rozpracovaný koncept (nebo uložená verze), jak ho uvidí návštěvníci
// při současném tarifu. Vidí ho jen majitel.
export default async function ShopPreviewPage({ searchParams }: { searchParams: Promise<StockQuery> }) {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/ucet/stranka');
  const p = await getShopProfile(user.id);
  if (!p || !PLANS[p.plan].shopPage) redirect('/ucet/stranka');
  const supabase = await createClient();
  const { data } = await supabase.from('shop_page_drafts').select('draft').eq('user_id', user.id).maybeSingle();
  const saved = data?.draft ? sanitizeConfig(data.draft, user.id, p.seller.kind) : p.saved;
  return (
    <>
      {/* Náhled ukazuje jen stránku obchodu, bez hlavičky a patičky webu. */}
      <style>{'body > header, body > footer, body > * > header, body > * > footer { display: none !important; }'}</style>
      <ShopPageView p={{ ...p, saved, config: effectiveConfig(saved, p.plan) }} query={await searchParams} preview edit baseOverride="/ucet/stranka/nahled" />
    </>
  );
}
