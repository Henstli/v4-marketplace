// Zprávy mezi uživateli (jen na serveru). Čte se přes RLS, zapisuje přes funkce v databázi.
import { methodName, SHIPPING_PACKING, type PaymentMethod } from './delivery';
import { deliveryLine } from './order-flow';
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
  /** Počet nových zpráv od druhé strany */
  unreadCount: number;
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
  /** Návrh ceny: bublina s cenou (price) nebo řádek o změně stavu (price = null) */
  offer: ChatOffer | null;
}

/** Návrh ceny v konverzaci (cena dohodou). */
export interface ChatOffer {
  id: string;
  /** Cena v této zprávě; null u řádku o změně stavu */
  price: number | null;
  /** Předchozí cena v témže smlouvání */
  previous: number | null;
  /** Nejnovější cena návrhu: jen ta má akce, starší jsou „Nahrazeno“ */
  current: boolean;
  status: 'open' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'sold_out';
  quantity: number;
  /** Kdo navrhl současnou cenu: přijmout ji může jen druhá strana */
  lastByMe: boolean;
  /** Jsem v tomto návrhu kupující */
  buyer: boolean;
  expiresAt: string;
  orderNumber: number | null;
}

/** Objednávka jako bublina v konverzaci. */
export interface ChatOrder {
  id: string;
  number: number;
  total: number;
  shipping: number;
  pickup: boolean;
  delivery: 'ship' | 'pickup';
  status: string;
  /** Do kdy musí prodejce potvrdit (jen u čekající objednávky) */
  expiresAt: string | null;
  /** Způsob platby (prázdné u starších objednávek) a kdy kupující klikl na Zaplaceno */
  payment: PaymentMethod | null;
  buyerPaidAt: string | null;
  /** Navržená vyšší doprava, čeká na kupujícího */
  shipChange: number | null;
  /** Doprava a platba jedním řádkem */
  deliveryLine: string;
  /** Název dopravce pro řádek Doprava a strop úpravy dopravy (null = bez stropu) */
  carrierName: string;
  shipCap: number | null;
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
  /** null = cena dohodou */
  price: number | null;
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
  // Počet nových zpráv jen u nepřečtených konverzací (DS Messages, varianta A).
  const [people, counts] = await Promise.all([
    getPeople([...new Set(others.filter((x): x is string => !!x))]),
    Promise.all(rows.map(async (c) => {
      if (!unreadFor(c, me)) return 0;
      const read = c.user_a === me ? c.a_read_at : c.b_read_at;
      let q = supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', c.id).neq('sender_id', me);
      if (read) q = q.gt('created_at', read);
      const { count } = await q;
      return Math.max(count ?? 1, 1);
    })),
  ]);
  return rows.map((c, i) => ({
    id: c.id,
    other: (others[i] && people.get(others[i]!)) || null,
    lastBody: c.last_body,
    lastAt: c.last_message_at,
    lastMine: c.last_sender === me,
    unread: unreadFor(c, me),
    unreadCount: counts[i],
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
    .returns<Array<{ id: number; sender_id: string | null; kind: string; body: string; created_at: string; order_id: string | null; listing_id?: string | null; offer_id?: string | null; offer_price?: number | null }>>();
  let { data: rows, error } = await query('id, sender_id, kind, body, created_at, order_id, listing_id, offer_id, offer_price');
  // Bez migrací price_offers a message_listing sloupce ještě nejsou.
  if (error) ({ data: rows, error } = await query('id, sender_id, kind, body, created_at, order_id, listing_id'));
  if (error) ({ data: rows } = await query('id, sender_id, kind, body, created_at, order_id'));
  const list = (rows ?? []).reverse();
  const offers = await getOffers(me, list);
  const listings = await getListingRefs([...new Set(list.map((m) => m.listing_id).filter((x): x is string => !!x))]);
  const orderIds = [...new Set(list.filter((m) => m.kind === 'order' && m.order_id).map((m) => m.order_id as string))];
  const { data: orders } = orderIds.length
    ? await supabase
      .from('orders')
      .select('id, number, total_czk, shipping_czk, delivery, status, expires_at, payment, carrier, carrier_label, buyer_paid_at, ship_change_czk, order_items(quantity, price_czk, condition, cards(name))')
      .in('id', orderIds)
    : { data: [] };
  // Strop úpravy dopravy: ceník větší zásilky + balné (jako na stránce Objednávky).
  const carriers = [...new Set((orders ?? []).map((o) => o.carrier as string | null).filter((c): c is string => !!c))];
  const { data: rates } = carriers.length
    ? await supabase.from('carrier_rates').select('carrier, price_czk, heavy_czk').in('carrier', carriers)
    : { data: [] };
  const caps = new Map((rates ?? []).map((r) => [r.carrier as string, Math.max(r.heavy_czk as number, r.price_czk as number) + SHIPPING_PACKING]));
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
      delivery: o.delivery === 'pickup' ? 'pickup' : 'ship',
      status: o.status as string,
      expiresAt: (o.expires_at as string | null) ?? null,
      payment: (o.payment as PaymentMethod | null) ?? null,
      buyerPaidAt: (o.buyer_paid_at as string | null) ?? null,
      shipChange: (o.ship_change_czk as number | null) ?? null,
      deliveryLine: deliveryLine({ delivery: o.delivery as 'ship' | 'pickup', payment: (o.payment as PaymentMethod | null) ?? null, carrier: o.carrier as string | null, carrier_label: o.carrier_label as string | null }),
      carrierName: o.carrier ? methodName({ carrier: o.carrier as string, label: o.carrier_label as string | null }) : 'Doprava',
      shipCap: (o.carrier && caps.get(o.carrier as string)) ?? null,
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
      offer: (m.offer_id && offers.get(m.id)) || null,
    })),
  };
}

/** Návrhy ceny ke zprávám: u každé zprávy s cenou předchozí cena a zda je nejnovější. */
async function getOffers(
  me: string,
  list: Array<{ id: number; offer_id?: string | null; offer_price?: number | null }>,
): Promise<Map<number, ChatOffer>> {
  const out = new Map<number, ChatOffer>();
  const ids = [...new Set(list.map((m) => m.offer_id).filter((x): x is string => !!x))];
  if (!ids.length) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from('price_offers')
    .select('id, buyer_id, last_by, status, quantity, expires_at, orders(number)')
    .in('id', ids);
  const byId = new Map((data ?? []).map((o) => [o.id as string, o]));
  const last = new Map<string, number>();
  for (const m of list) if (m.offer_id && m.offer_price != null) last.set(m.offer_id, m.id);
  const prev = new Map<string, number>();
  for (const m of list) {
    const o = m.offer_id ? byId.get(m.offer_id) : null;
    if (!o || !m.offer_id) continue;
    const order = (Array.isArray(o.orders) ? o.orders[0] : o.orders) as { number: number } | null;
    out.set(m.id, {
      id: o.id as string,
      price: m.offer_price ?? null,
      previous: m.offer_price != null ? prev.get(m.offer_id) ?? null : null,
      current: last.get(m.offer_id) === m.id,
      status: o.status as ChatOffer['status'],
      quantity: o.quantity as number,
      lastByMe: o.last_by === me,
      buyer: o.buyer_id === me,
      expiresAt: o.expires_at as string,
      orderNumber: order?.number ?? null,
    });
    if (m.offer_price != null) prev.set(m.offer_id, m.offer_price);
  }
  return out;
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
      price: (l.price_czk as number | null) ?? null,
    });
  }
  return out;
}

/** Moje nabídka skladem pro návrh ceny v konverzaci. */
export interface MyListing { id: string; label: string; price: number | null; quantity: number }

/** Nabídky prodejce skladem (nejnovější), ze kterých může v konverzaci navrhnout cenu. */
export async function getMyListings(me: string): Promise<MyListing[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('listings')
    .select('id, price_czk, condition, quantity, cards(name, number, card_sets(code))')
    .eq('seller_id', me)
    .gt('quantity', 0)
    .order('created_at', { ascending: false })
    .limit(300);
  return (data ?? []).map((l) => {
    const card = (Array.isArray(l.cards) ? l.cards[0] : l.cards) as { name: string; number: string; card_sets: { code: string } | { code: string }[] | null } | null;
    const set = Array.isArray(card?.card_sets) ? card?.card_sets[0] : card?.card_sets;
    return {
      id: l.id as string,
      label: `${card?.name ?? 'Karta'}${set?.code ? ` · ${set.code} ${card?.number ?? ''}` : ''} · ${l.condition}`,
      price: (l.price_czk as number | null) ?? null,
      quantity: l.quantity as number,
    };
  });
}
