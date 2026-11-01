import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { type ListParams, type OfferRow, OrdersListView } from './list-view';
import { markSellerRestricted, ORDER_SELECT, type OrderRow } from './parts';

export const metadata: Metadata = { title: 'Objednávky' };

type Props = { searchParams: Promise<ListParams> };

export default async function OrdersPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/objednavky');
  const sp = await searchParams;

  const supabase = await createClient();
  const [{ data: orders }, { data: offers }] = await Promise.all([
    supabase.from('orders').select(ORDER_SELECT).order('created_at', { ascending: false }).returns<OrderRow[]>(),
    // Otevřené návrhy ceny (bez migrace price_offers tabulka není a návrhy se neukážou).
    supabase
      .from('price_offers')
      .select('id, buyer_id, seller_id, last_by, price_czk, quantity, expires_at, created_at, listings(cards(name, image_url, game_id))')
      .eq('status', 'open')
      .gt('expires_at', new Date().toISOString())
      .returns<OfferRow[]>(),
  ]);
  const all = orders ?? [];
  const ids = new Set<string>();
  for (const o of all) for (const id of [o.buyer_id, o.seller_id]) if (id && id !== user.id) ids.add(id);
  for (const o of offers ?? []) ids.add(o.buyer_id === user.id ? o.seller_id : o.buyer_id);
  const [{ data: profiles }] = await Promise.all([
    ids.size ? supabase.from('profiles').select('id, display_name').in('id', [...ids]) : Promise.resolve({ data: [] as Array<{ id: string; display_name: string }> }),
    markSellerRestricted(supabase, all.filter((o) => o.buyer_id === user.id)),
  ]);
  const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.display_name as string) || 'Uživatel']));
  return <OrdersListView uid={user.id} all={all} offers={offers ?? []} names={names} sp={sp} />;
}
