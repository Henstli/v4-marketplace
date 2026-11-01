// Přátelé (jen na serveru): podložka profilu a stránka Přátelé v centru účtu.
import type { MatFriend } from '@/components/profile/MatFriends';
import type { FriendTile } from '@/components/friends/FriendsGrid';
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

/** Všechny vztahy přihlášeného: přátelé, žádosti pro mě, odeslané žádosti. */
export async function getMyFriends(me: string): Promise<{ friends: FriendTile[]; incoming: FriendTile[]; outgoing: FriendTile[] }> {
  const empty = { friends: [], incoming: [], outgoing: [] };
  if (!isSupabaseConfigured()) return empty;
  const supabase = await createClient();
  const [{ data: rows }, { data: trades }] = await Promise.all([
    supabase.from('friendships').select('requester, addressee, created_at, accepted_at').order('created_at', { ascending: false }).limit(300),
    supabase.rpc('profile_friends', { p_profile: me }),
  ]);
  if (!rows?.length) return empty;
  const tradeMap = new Map(((trades ?? []) as Array<{ id: string; trades: number }>).map((t) => [t.id, t.trades]));
  const other = (r: { requester: string; addressee: string }) => (r.requester === me ? r.addressee : r.requester);
  const map = await cards(rows.map(other));
  const tile = (r: (typeof rows)[number], status: FriendStatus): FriendTile[] => {
    const card = map.get(other(r));
    return card ? [{ card, trades: tradeMap.get(card.id) ?? 0, status, since: r.accepted_at ?? r.created_at }] : [];
  };
  return {
    friends: rows.filter((r) => r.accepted_at).flatMap((r) => tile(r, 'friends')),
    incoming: rows.filter((r) => !r.accepted_at && r.addressee === me).flatMap((r) => tile(r, 'incoming')),
    outgoing: rows.filter((r) => !r.accepted_at && r.requester === me).flatMap((r) => tile(r, 'outgoing')),
  };
}
