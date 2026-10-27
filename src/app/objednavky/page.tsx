import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CardThumb, ChipLink, Price } from '@/components/trezor';
import { thumbUrl } from '@/lib/images';
import { ExpiryStatus } from '@/components/orders/Expiry';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { BuyerActions, ENDED, loadContact, loadDeliveries, loadPayment, loadShipCaps, ORDER_SELECT, OrderCard, type OrderRow, SellerActions } from './parts';
import styles from './orders.module.css';

export const metadata: Metadata = { title: 'Objednávky' };

interface OfferRow {
  id: string; buyer_id: string; seller_id: string; last_by: string; price_czk: number; quantity: number; expires_at: string;
  listings: { cards: { name: string; image_url: string | null; game_id: string | null } | Array<{ name: string; image_url: string | null; game_id: string | null }> | null } | null;
}

type Props = { searchParams: Promise<{ nova?: string; tab?: string }> };

export default async function OrdersPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/objednavky');
  const { nova, tab: tabParam } = await searchParams;

  const supabase = await createClient();
  const [{ data: orders }, { data: profiles }, { data: reviews }, { data: offers }] = await Promise.all([
    supabase
      .from('orders')
      .select(ORDER_SELECT)
      .order('created_at', { ascending: false })
      .returns<OrderRow[]>(),
    supabase.from('profiles').select('id, display_name'),
    supabase.from('reviews').select('order_id'),
    // Otevřené návrhy ceny (bez migrace price_offers tabulka není a blok se neukáže).
    supabase
      .from('price_offers')
      .select('id, buyer_id, seller_id, last_by, price_czk, quantity, expires_at, listings(cards(name, image_url, game_id))')
      .eq('status', 'open')
      .gt('expires_at', new Date().toISOString())
      .order('updated_at', { ascending: false })
      .returns<OfferRow[]>(),
  ]);
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name as string]));
  const reviewed = new Set((reviews ?? []).map((r) => r.order_id as string));
  const bought = (orders ?? []).filter((o) => o.buyer_id === user.id);
  const sold = (orders ?? []).filter((o) => o.seller_id === user.id);
  const all = orders ?? [];
  const [contacts, payments, caps, deliveries] = await Promise.all([
    Promise.all(all.map((o) => loadContact(supabase, o))).then((r) => new Map(all.map((o, i) => [o.id, r[i]]))),
    Promise.all(all.map((o) => loadPayment(supabase, o))).then((r) => new Map(all.map((o, i) => [o.id, r[i]]))),
    loadShipCaps(supabase),
    loadDeliveries(supabase, all.filter((o) => !ENDED.has(o.status) && o.status !== 'delivered').map((o) => o.id)),
  ]);

  const boughtActive = bought.filter((o) => !ENDED.has(o.status));
  const soldActive = sold.filter((o) => !ENDED.has(o.status));
  // Výchozí záložka: prodeje, když na prodejce čeká potvrzení a nákupy nic nepotřebují.
  const tab = tabParam === 'prodeje' || tabParam === 'nakupy'
    ? tabParam
    : sold.some((o) => o.status === 'requested') && !bought.some((o) => o.status === 'requested') ? 'prodeje' : 'nakupy';

  const buyerCard = (o: OrderRow) => (
    <OrderCard key={o.id} order={o} counterpart={`Prodejce: ${(o.seller_id && names.get(o.seller_id)) || 'smazaný účet'}`} contact={contacts.get(o.id)} payment={payments.get(o.id)} delivery={deliveries.get(o.id)} role="buyer">
      <BuyerActions o={o} reviewed={reviewed.has(o.id)} />
    </OrderCard>);
  const sellerCard = (o: OrderRow) => (
    <OrderCard key={o.id} order={o} counterpart={`Kupující: ${(o.buyer_id && names.get(o.buyer_id)) || 'smazaný účet'}`} contact={contacts.get(o.id)} payment={payments.get(o.id)} delivery={deliveries.get(o.id)} role="seller">
      <SellerActions o={o} shipCap={o.carrier ? caps.get(o.carrier) : null} />
    </OrderCard>);

  return (
    <div className={`container ${styles.page}`}>
      <h1 className="t-heading-l">Objednávky</h1>
      {nova ? (
        <p className={styles.ok} role="status">
          Objednávka je odeslaná. Prodejce ji do 48 hodin potvrdí a přijde vám e-mail. Pak se s ním domluvíte na platbě a předání.
        </p>
      ) : null}

      {offers?.length ? (
        <section className={styles.offers} aria-labelledby="navrhy">
          <h2 id="navrhy" className="t-heading-m">Návrhy ceny</h2>
          <ul>
            {offers.map((o) => {
              const other = o.buyer_id === user.id ? o.seller_id : o.buyer_id;
              const listing = Array.isArray(o.listings) ? o.listings[0] : o.listings;
              const card = listing ? (Array.isArray(listing.cards) ? listing.cards[0] : listing.cards) : null;
              const myTurn = o.last_by !== user.id;
              return (
                <li key={o.id}>
                  <Link href={`/zpravy/${other}`} className={styles.offerRow}>
                    <CardThumb image={thumbUrl(card?.image_url ?? undefined)} color={card?.game_id ? `var(--game-${card.game_id}-art)` : undefined} size="sm" />
                    <span className={styles.offerText}>
                      <strong>{card?.name ?? 'Karta'}</strong>
                      <span className="t-small muted">
                        {o.buyer_id === user.id ? 'Prodejce' : 'Kupující'} {names.get(other) ?? 'smazaný účet'}
                        {o.quantity > 1 ? ` · ${o.quantity} ks` : ''}
                      </span>
                    </span>
                    <Price amount={o.price_czk} />
                    <ExpiryStatus expiresAt={o.expires_at} role={myTurn ? 'seller' : 'buyer'} label={myTurn ? 'Čeká na vás' : 'Čeká na odpověď'} act="Odpovězte do" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Nákupy a prodeje jako přepínač, ne pod sebou (Šimon 27. 10.). */}
      <nav className={styles.tabs} aria-label="Nákupy nebo prodeje">
        <ChipLink href="/objednavky?tab=nakupy" selected={tab === 'nakupy'}>Nákupy{boughtActive.length ? ` (${boughtActive.length})` : ''}</ChipLink>
        <ChipLink href="/objednavky?tab=prodeje" selected={tab === 'prodeje'}>Prodeje{soldActive.length ? ` (${soldActive.length})` : ''}</ChipLink>
      </nav>

      {tab === 'nakupy' ? (
        <section className={styles.section} aria-label="Nákupy">
          {boughtActive.length ? boughtActive.map(buyerCard) : (
            <p className="muted">{bought.length ? 'Žádný rozpracovaný nákup.' : 'Zatím jste nic nekoupili.'} <Link href="/karty">Procházet karty</Link></p>
          )}
          <Ended list={bought.filter((o) => ENDED.has(o.status))} render={buyerCard} />
        </section>
      ) : (
        <section className={styles.section} aria-label="Prodeje">
          {soldActive.length ? soldActive.map(sellerCard) : (
            <p className="muted">{sold.length ? 'Žádný rozpracovaný prodej.' : 'Zatím nemáte žádné prodeje.'} <Link href="/prodat">Vystavit kartu</Link></p>
          )}
          <Ended list={sold.filter((o) => ENDED.has(o.status))} render={sellerCard} />
        </section>
      )}
    </div>
  );
}

/** Zrušené, odmítnuté a vypršelé objednávky sbalené pod aktivními. */
function Ended({ list, render }: { list: OrderRow[]; render: (o: OrderRow) => React.ReactNode }) {
  if (!list.length) return null;
  return (
    <details className={styles.ended}>
      <summary>Zrušené a vypršelé ({list.length})</summary>
      <div className={styles.endedList}>{list.map(render)}</div>
    </details>
  );
}

