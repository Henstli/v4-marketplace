import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isUserId } from '@/lib/messages';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { type Offer, type OfferViewData, OfferView } from '../../offer-view';

export const metadata: Metadata = { title: 'Návrh ceny' };

type Props = { params: Promise<{ id: string }> };

export default async function OfferDetailPage({ params }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/prihlaseni?dalsi=/objednavky/navrh/${encodeURIComponent(id)}`);
  if (!isUserId(id)) notFound();

  const supabase = await createClient();
  const { data: offer } = await supabase
    .from('price_offers')
    .select('id, listing_id, buyer_id, seller_id, quantity, price_czk, last_by, status, expires_at, order_id, created_at, listings(price_czk, condition, language, quantity, cards(name, slug, image_url, game_id, number, card_sets(code, name)))')
    .eq('id', id)
    .maybeSingle<Offer>();
  if (!offer || (offer.buyer_id !== user.id && offer.seller_id !== user.id)) notFound();
  const role = offer.buyer_id === user.id ? 'buyer' : 'seller';
  const otherId = role === 'buyer' ? offer.seller_id : offer.buyer_id;

  const [{ data: other }, { data: rounds }, { data: order }] = await Promise.all([
    supabase.from('profiles').select('display_name, kind').eq('id', otherId).maybeSingle(),
    supabase.from('messages').select('sender_id, offer_price, created_at').eq('offer_id', offer.id).not('offer_price', 'is', null).order('created_at', { ascending: false }),
    offer.order_id ? supabase.from('orders').select('number').eq('id', offer.order_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return <OfferView offer={offer} role={role} uid={user.id} otherId={otherId} other={other} rounds={(rounds ?? []) as OfferViewData['rounds']} order={order} />;
}
