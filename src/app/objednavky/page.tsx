import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChipLink } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { BuyerActions, ENDED, loadContact, loadPayment, ORDER_SELECT, OrderCard, type OrderRow, SellerActions } from './parts';
import styles from './orders.module.css';

export const metadata: Metadata = { title: 'Objednávky' };

type Props = { searchParams: Promise<{ nova?: string; tab?: string }> };

export default async function OrdersPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/objednavky');
  const { nova, tab: tabParam } = await searchParams;

  const supabase = await createClient();
  const [{ data: orders }, { data: profiles }, { data: reviews }] = await Promise.all([
    supabase
      .from('orders')
      .select(ORDER_SELECT)
      .order('created_at', { ascending: false })
      .returns<OrderRow[]>(),
    supabase.from('profiles').select('id, display_name'),
    supabase.from('reviews').select('order_id'),
  ]);
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name as string]));
  const reviewed = new Set((reviews ?? []).map((r) => r.order_id as string));
  const bought = (orders ?? []).filter((o) => o.buyer_id === user.id);
  const sold = (orders ?? []).filter((o) => o.seller_id === user.id);
  const all = orders ?? [];
  const [contacts, payments] = await Promise.all([
    Promise.all(all.map((o) => loadContact(supabase, o))).then((r) => new Map(all.map((o, i) => [o.id, r[i]]))),
    Promise.all(all.map((o) => loadPayment(supabase, o))).then((r) => new Map(all.map((o, i) => [o.id, r[i]]))),
  ]);

  const boughtActive = bought.filter((o) => !ENDED.has(o.status));
  const soldActive = sold.filter((o) => !ENDED.has(o.status));
  // Výchozí záložka: prodeje, když na prodejce čeká potvrzení a nákupy nic nepotřebují.
  const tab = tabParam === 'prodeje' || tabParam === 'nakupy'
    ? tabParam
    : sold.some((o) => o.status === 'requested') && !bought.some((o) => o.status === 'requested') ? 'prodeje' : 'nakupy';

  const buyerCard = (o: OrderRow) => (
    <OrderCard key={o.id} order={o} counterpart={`Prodejce: ${(o.seller_id && names.get(o.seller_id)) || 'smazaný účet'}`} contact={contacts.get(o.id)} payment={payments.get(o.id)} role="buyer">
      <BuyerActions o={o} reviewed={reviewed.has(o.id)} />
    </OrderCard>);
  const sellerCard = (o: OrderRow) => (
    <OrderCard key={o.id} order={o} counterpart={`Kupující: ${(o.buyer_id && names.get(o.buyer_id)) || 'smazaný účet'}`} contact={contacts.get(o.id)} payment={payments.get(o.id)} role="seller">
      <SellerActions o={o} />
    </OrderCard>);

  return (
    <div className={`container ${styles.page}`}>
      <h1 className="t-heading-l">Objednávky</h1>
      {nova ? (
        <p className={styles.ok} role="status">
          Objednávka je odeslaná. Prodejce ji do 48 hodin potvrdí a přijde vám e-mail. Pak se s ním domluvíte na platbě a předání.
        </p>
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

