import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { fetchPrepay } from '@/lib/prepay';
import { loadOpenReports } from '@/lib/reports';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { type DetailData, OrderDetailView } from '../detail-view';
import { loadDeliveries, loadShipCaps, markSellerRestricted, ORDER_SELECT, type OrderRow } from '../parts';

type Props = { params: Promise<{ cislo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cislo } = await params;
  return { title: `Objednávka č. ${cislo}` };
}

export default async function OrderDetailPage({ params }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const { cislo } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/prihlaseni?dalsi=/objednavky/${encodeURIComponent(cislo)}`);
  const number = Number(cislo);
  if (!Number.isInteger(number) || number < 1) notFound();

  const supabase = await createClient();
  // Objednávku vrátí databáze jen kupujícímu a prodejci.
  const { data: order } = await supabase.from('orders').select(ORDER_SELECT).eq('number', number).maybeSingle<OrderRow>();
  if (!order) notFound();
  const role = order.buyer_id === user.id ? 'buyer' : 'seller';
  const otherId = role === 'buyer' ? order.seller_id : order.buyer_id;
  const sellerId = order.seller_id;
  const payTransfer = (order.payment ?? 'transfer') === 'transfer';
  const needPay = role === 'buyer' && order.status === 'confirmed' && payTransfer && !order.buyer_paid_at && order.ship_change_czk == null;

  const [{ data: other }, { data: events }, { data: review }, prepay, caps, deliveries, reports, , { data: mine }, { data: sellerReviews }] = await Promise.all([
    otherId ? supabase.from('profiles').select('display_name, kind').eq('id', otherId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('messages').select('kind, body, created_at').eq('order_id', order.id).order('created_at', { ascending: false }),
    supabase.from('reviews').select('order_id, rating, comment, reply').eq('order_id', order.id).maybeSingle(),
    needPay ? fetchPrepay(supabase, order.id) : Promise.resolve(null),
    loadShipCaps(supabase),
    loadDeliveries(supabase, [order.id]),
    loadOpenReports(supabase, [order.id]),
    role === 'buyer' ? markSellerRestricted(supabase, [order]) : Promise.resolve(),
    supabase.from('reports').select('id').eq('order_id', order.id).eq('reporter_id', user.id).neq('status', 'closed').maybeSingle(),
    sellerId ? supabase.from('reviews').select('rating').eq('seller_id', sellerId).is('hidden_at', null) : Promise.resolve({ data: [] as Array<{ rating: number }> }),
  ]);
  return (
    <OrderDetailView
      order={order} role={role} uid={user.id} other={other} events={(events ?? []) as DetailData['events']}
      review={review as DetailData['review']} prepay={prepay} caps={caps} delivery={deliveries.get(order.id)}
      report={reports.get(order.id)} mine={!!mine} ratings={(sellerReviews ?? []).map((r) => r.rating as number)}
    />
  );
}
