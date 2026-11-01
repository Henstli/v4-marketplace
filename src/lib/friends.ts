// Přátelé (jen na serveru): podložka profilu a stránka Přátelé v centru účtu.
import type { MatFriend } from '@/components/profile/MatFriends';
import type { FriendRow } from '@/components/messages/FriendsPanel';
import type { FriendStatus } from '@/app/ucet/pratele-actions';
import { getProfileCard } from './profile';
import type { ProfileCardData } from './profile-card';
import { isSupabaseConfigured } from './supabase/config';
import { createClient } from './supabase/server';

async function cards(ids: string[]): Promise<Map<string, ProfileCardData>> {
  const list = await Promise.all(ids.map((id) => getProfileCard(id)));
  return new Map(list.filter((c): c is ProfileCardData => !!c).map((c) => [c.id, c]));
}

/** Balíček na podložce: Společní přátelé, Zkušenosti přátel, nebo vlastní přátelé. */
export async function getProfileFriends(profile: string): Promise<MatFriend[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc('profile_friends', { p_profile: profile });
  const rows = (data ?? []) as Array<{ id: string; trades: number; rating: number | null; comment: string | null }>;
  const map = await cards(rows.map((r) => r.id));
  return rows.flatMap((r) => {
    const card = map.get(r.id);
    return card ? [{ card, trades: r.trades, rating: r.rating, comment: r.comment }] : [];
  });
}

export async function getFriendStatus(other: string): Promise<FriendStatus> {
  if (!isSupabaseConfigured()) return 'none';
  const supabase = await createClient();
  const { data } = await supabase.rpc('friend_status', { p_other: other });
  return (data as FriendStatus | null) ?? 'none';
}

/** Přátelé do Zpráv (záložka Přátelé): přátelé, žádosti pro mě a odeslané žádosti. */
export async function getChatFriends(me: string): Promise<FriendRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const [{ data: rows }, { data: trades }] = await Promise.all([
    supabase.from('friendships').select('requester, addressee, created_at, accepted_at').order('created_at', { ascending: false }).limit(300),
    supabase.rpc('profile_friends', { p_profile: me }),
  ]);
  if (!rows?.length) return [];
  const tradeMap = new Map(((trades ?? []) as Array<{ id: string; trades: number }>).map((t) => [t.id, t.trades]));
  const other = (r: { requester: string; addressee: string }) => (r.requester === me ? r.addressee : r.requester);
  const map = await cards(rows.map(other));
  return rows.flatMap((r) => {
    const c = map.get(other(r));
    if (!c) return [];
    const status: FriendRow['status'] = r.accepted_at ? 'friends' : r.addressee === me ? 'incoming' : 'outgoing';
    return [{ id: c.id, name: c.name, avatar: c.avatar, presence: c.presence, sub: `${c.typeLead}${c.city ? ` · ${c.city}` : ''}`, trades: tradeMap.get(c.id) ?? 0, status }];
  });
}
