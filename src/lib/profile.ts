// Načítání karty profilu z databáze (jen na serveru).
import { cache } from 'react';
import { getSeller } from './catalog';
import { toPlan } from './plans';
import {
  effectiveFrame, loyaltyLevel, monthsSince, sanitizeCrop, typeLineLabel,
  type CardForm, type Presence, type ProfileCardData,
} from './profile-card';
import { mediaImage } from './shop';
import { isSupabaseConfigured } from './supabase/config';
import { createPublicClient } from './supabase/public';

interface CardRow {
  card_style: string | null;
  card_form: string | null;
  card_frame: string | null;
  card_city: string | null;
  status_text: string | null;
  member_no: number | null;
  created_at: string | null;
  avatar_path?: string | null;
  avatar_crop?: unknown;
}

export const getProfileCard = cache(async (id: string): Promise<ProfileCardData | null> => {
  const seller = await getSeller(id);
  if (!seller) return null;
  const base: ProfileCardData = {
    id: seller.id, name: seller.name, kind: seller.kind, plan: 'free', memberNo: null, memberYear: null,
    status: null, presence: 'offline', typeLead: seller.kind === 'shop' ? 'Obchod' : 'Sběratel', typeStyle: null,
    city: null, frame: 'sklo', about: null, avatar: null, photo: null, loyalty: null,
    rating: seller.rating, reviews: seller.sales, listings: 0,
  };
  if (!isSupabaseConfigured()) return base;
  const db = createPublicClient();
  const [prof, page, loyal, pres, offers] = await Promise.all([
    db.from('profiles').select('card_style, card_form, card_frame, card_city, status_text, member_no, created_at, avatar_path, avatar_crop').eq('id', id).maybeSingle(),
    db.from('shop_pages').select('logo_path, about').eq('user_id', id).maybeSingle(),
    db.rpc('seller_loyalty', { p_ids: [id] }),
    db.rpc('profile_presence', { p_ids: [id] }),
    db.from('listings').select('id', { count: 'exact', head: true }).eq('seller_id', id).gt('quantity', 0),
  ]);
  // Bez migrace profile_card (sloupce chybí) se karta ukáže se základními údaji.
  const row = (prof.error ? null : prof.data) as CardRow | null;
  const sub = ((loyal.data ?? []) as { plan: string; since: string }[])[0];
  const plan = toPlan(sub?.plan);
  const level = loyaltyLevel(plan, sub?.since ?? null);
  const form: CardForm = row?.card_form === 'f' ? 'f' : 'm';
  const type = typeLineLabel(seller.kind, row?.card_style, form);
  const crop = sanitizeCrop(row?.avatar_crop);
  const photoSrc = row?.avatar_path?.startsWith(`${id}/`) ? mediaImage(row.avatar_path, 1080) : null;
  return {
    ...base,
    plan,
    memberNo: row?.member_no ?? null,
    memberYear: row?.created_at ? new Date(row.created_at).getFullYear() : null,
    status: row?.status_text?.trim() || null,
    presence: ((pres.data ?? []) as { presence: Presence }[])[0]?.presence ?? 'offline',
    typeLead: type.lead,
    typeStyle: type.style,
    city: row?.card_city?.trim() || null,
    frame: effectiveFrame(row?.card_frame, plan),
    about: (page.data?.about as string | null | undefined)?.trim() || null,
    avatar: mediaImage(page.data?.logo_path as string | null | undefined, 256),
    photo: photoSrc && crop ? { src: photoSrc, crop } : null,
    loyalty: level ? { id: level.id, name: level.name, label: level.label, months: monthsSince(sub!.since) } : null,
    listings: offers.count ?? 0,
  };
});
