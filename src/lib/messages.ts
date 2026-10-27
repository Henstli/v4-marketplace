// Zprávy mezi uživateli (jen na serveru). Čte se přes RLS, zapisuje přes funkce v databázi.
import { PLANS } from './plans';
import { getSellerBrands, getSellerPlans } from './shop';
import { planColor, shopHref } from './shop-config';
import { createClient } from './supabase/server';
import { LANGUAGE_NAMES, type Language } from './types';

export interface Person {
  id: string;
  name: string;
  logo: string | null;
  color: string;
  /** Veřejná stránka: vlastní stránka obchodu nebo základní profil */
  href: string;
  kind: 'shop' | 'private';
}

export interface ConversationItem {
  id: string;
  /** Druhá strana; null, když smazala účet */
  other: Person | null;
  lastBody: string;
  lastAt: string;
  lastMine: boolean;
  unread: boolean;
}

export interface ChatMessage {
  id: number;
  mine: boolean;
  kind: 'text' | 'order' | 'status';
  body: string;
  createdAt: string;
  order: ChatOrder | null;
  /** Nabídka, ke které se zpráva ptá */
  listing: ListingRef | null;
}

/** Objednávka jako bublina v konverzaci. */
export interface ChatOrder {
  id: string;
  number: number;
  total: number;
  shipping: number;
  pickup: boolean;
  status: string;
  /** Počet kusů celkem */
  count: number;
  items: Array<{ name: string; condition: string; quantity: number; price: number }>;
}

/** Krátký popis nabídky pro dotaz v konverzaci. */
export interface ListingRef {
  id: string;
  cardName: string;
  cardSlug: string;
  setLabel: string;
  image: string | null;
  condition: string;
  language: string;
  price: number;
}

interface ConversationRow {
  id: string;
  user_a: string | null;
  user_b: string | null;
  last_message_at: string;
  last_sender: string | null;
  last_body: string;
  a_read_at: string | null;
  b_read_at: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUserId = (id: string) => UUID.test(id);

/** Jména, loga a odkazy lidí v konverzacích. */
export async function getPeople(ids: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>();
  if (!ids.length) return out;
  const supabase = await createClient();
  const [{ data: profiles }, brands, plans] = await Promise.all([
    supabase.from('profiles').select('id, display_name, kind').in('id', ids),
    getSellerBrands(ids),
    getSellerPlans(ids),
  ]);
  for (const p of profiles ?? []) {
    const b = brands.get(p.id);
    const plan = plans.get(p.id) ?? 'free';
    const kind = p.kind === 'shop' ? 'shop' : 'private';
    out.set(p.id, {
      id: p.id,
      name: p.display_name,
      logo: plan !== 'free' ? b?.logo ?? null : null,
      color: planColor(b?.color ?? 'blue', plan),
      href: PLANS[plan].shopPage && b?.published && b.slug ? shopHref(kind, b.slug) : `/prodejci/${p.id}`,
      kind,
    });
  }
  return out;
}

function unreadFor(c: ConversationRow, me: string): boolean {
  if (c.last_sender === me) return false;
  const read = c.user_a === me ? c.a_read_at : c.b_read_at;
  return !read || read < c.last_message_at;
}

export async function getConversations(me: string): Promise<ConversationItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('conversations')
    .select('id, user_a, user_b, last_message_at, last_sender, last_body, a_read_at, b_read_at')
    .order('last_message_at', { ascending: false })
    .limit(100)
    .returns<ConversationRow[]>();
  const rows = data ?? [];
  const others = rows.map((c) => (c.user_a === me ? c.user_b : c.user_a));
  const people = await getPeople([...new Set(others.filter((x): x is string => !!x))]);
  return rows.map((c, i) => ({
    id: c.id,
    other: (others[i] && people.get(others[i]!)) || null,
    lastBody: c.last_body,
    lastAt: c.last_message_at,
    lastMine: c.last_sender === me,
    unread: unreadFor(c, me),
  }));
}

/** Konverzace s druhým uživatelem (null, když spolu ještě nepsali) a posledních 200 zpráv. */
export async function getThread(me: string, other: string): Promise<{ id: string | null; unread: boolean; messages: ChatMessage[] }> {
  const supabase = await createClient();
  const [a, b] = me < other ? [me, other] : [other, me];
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, user_a, user_b, last_message_at, last_sender, last_body, a_read_at, b_read_at')
    .eq('user_a', a)
    .eq('user_b', b)
    .maybeSingle<ConversationRow>();
  if (!conv) return { id: null, unread: false, messages: [] };
  const query = (cols: string) => supabase
    .from('messages')
    .select(cols)
    .eq('conversation_id', conv.id)
    .order('id', { ascending: false })
    .limit(200)
    .returns<Array<{ id: number; sender_id: string | null; kind: string; body: string; created_at: string; order_id: string | null; listing_id?: string | null }>>();
  let { data: rows, error } = await query('id, sender_id, kind, body, created_at, order_id, listing_id');
  // Bez migrace message_listing sloupec listing_id ještě není.
  if (error) ({ data: rows } = await query('id, sender_id, kind, body, created_at, order_id'));
  const list = (rows ?? []).reverse();
  const listings = await getListingRefs([...new Set(list.map((m) => m.listing_id).filter((x): x is string => !!x))]);
  const orderIds = [...new Set(list.filter((m) => m.kind === 'order' && m.order_id).map((m) => m.order_id as string))];
  const { data: orders } = orderIds.length
    ? await supabase
      .from('orders')
      .select('id, number, total_czk, shipping_czk, delivery, status, order_items(quantity, price_czk, condition, cards(name))')
      .in('id', orderIds)
    : { data: [] };
  const byId = new Map((orders ?? []).map((o) => {
    const items = ((o.order_items ?? []) as unknown as Array<{ quantity: number; price_czk: number; condition: string; cards: { name: string } | { name: string }[] | null }>)
      .map((i) => {
        const card = Array.isArray(i.cards) ? i.cards[0] : i.cards;
        return { name: card?.name ?? 'Karta', condition: i.condition, quantity: i.quantity, price: i.price_czk };
      });
    return [o.id as string, {
      id: o.id as string,
      number: o.number as number,
      total: o.total_czk as number,
      shipping: (o.shipping_czk as number | null) ?? 0,
      pickup: o.delivery === 'pickup',
      status: o.status as string,
      count: items.reduce((s, i) => s + i.quantity, 0),
      items,
    } satisfies ChatOrder];
  }));
  return {
    id: conv.id,
    unread: unreadFor(conv, me),
    messages: list.map((m) => ({
      id: m.id as number,
      mine: m.sender_id === me,
      kind: m.kind as ChatMessage['kind'],
      body: m.body as string,
      createdAt: m.created_at as string,
      order: m.kind === 'order' && m.order_id ? byId.get(m.order_id as string) ?? null : null,
      listing: m.listing_id ? listings.get(m.listing_id) ?? null : null,
    })),
  };
}

/** Nabídky pro dotazy v konverzaci (i vyprodané, aby šlo poznat, o co šlo). */
export async function getListingRefs(ids: string[]): Promise<Map<string, ListingRef>> {
  const out = new Map<string, ListingRef>();
  if (!ids.length) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from('listings')
    .select('id, price_czk, condition, language, graded, cards(name, slug, number, image_url, card_sets(code))')
    .in('id', ids);
  for (const l of data ?? []) {
    const card = (Array.isArray(l.cards) ? l.cards[0] : l.cards) as
      | { name: string; slug: string; number: string; image_url: string | null; card_sets: { code: string } | { code: string }[] | null }
      | null;
    if (!card) continue;
    const set = Array.isArray(card.card_sets) ? card.card_sets[0] : card.card_sets;
    out.set(l.id as string, {
      id: l.id as string,
      cardName: card.name,
      cardSlug: card.slug,
      setLabel: [set?.code, card.number].filter(Boolean).join(' '),
      image: card.image_url,
      condition: (l.condition as string) + (l.graded ? ` · ${l.graded}` : ''),
      language: LANGUAGE_NAMES[l.language as Language] ?? String(l.language),
      price: l.price_czk as number,
    });
  }
  return out;
}
