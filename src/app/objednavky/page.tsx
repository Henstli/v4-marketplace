import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button, CardThumb, Price } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { addReview, setOrderStatus } from './actions';
import styles from './orders.module.css';

export const metadata: Metadata = { title: 'Objednávky' };

const STATUS: Record<string, string> = {
  pending_payment: 'Čeká na platbu',
  paid: 'Zaplaceno, čeká na odeslání',
  shipped: 'Odesláno',
  delivered: 'Doručeno',
  cancelled: 'Zrušeno',
};

interface OrderRow {
  id: string;
  // Prázdné, když druhá strana smazala účet.
  buyer_id: string | null;
  seller_id: string | null;
  status: string;
  total_czk: number;
  shipping_czk: number;
  created_at: string;
  order_items: Array<{ quantity: number; price_czk: number; condition: string | null; cards: { name: string; slug: string; image_url: string | null; game_id: string | null } | null }>;
}

type Props = { searchParams: Promise<{ nova?: string }> };

export default async function OrdersPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/objednavky');
  const { nova } = await searchParams;

  const supabase = await createClient();
  const [{ data: orders }, { data: profiles }, { data: reviews }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, buyer_id, seller_id, status, total_czk, shipping_czk, created_at, order_items(quantity, price_czk, condition, cards(name, slug, image_url, game_id))')
      .order('created_at', { ascending: false })
      .returns<OrderRow[]>(),
    supabase.from('profiles').select('id, display_name'),
    supabase.from('reviews').select('order_id'),
  ]);
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name as string]));
  const reviewed = new Set((reviews ?? []).map((r) => r.order_id as string));
  const bought = (orders ?? []).filter((o) => o.buyer_id === user.id);
  const sold = (orders ?? []).filter((o) => o.seller_id === user.id);

  return (
    <div className={`container ${styles.page}`}>
      <h1 className="t-heading-l">Objednávky</h1>
      {nova ? <p className={styles.ok} role="status">Objednávka je odeslaná. Prodejce teď kartu zabalí a odešle.</p> : null}

      <section className={styles.section}>
        <h2 className="t-heading-m">Nákupy</h2>
        {bought.length ? bought.map((o) => (
          <OrderCard key={o.id} order={o} counterpart={`Prodejce: ${(o.seller_id && names.get(o.seller_id)) || 'smazaný účet'}`}>
            {o.status === 'shipped' ? (
              <form action={setOrderStatus}>
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="status" value="delivered" />
                <Button type="submit">Potvrdit převzetí</Button>
              </form>
            ) : null}
            {o.status === 'delivered' && o.seller_id && !reviewed.has(o.id) ? (
              <form action={addReview} className={styles.review}>
                <input type="hidden" name="orderId" value={o.id} />
                <input type="hidden" name="sellerId" value={o.seller_id} />
                <label className={styles.field}>
                  <span className="t-label muted">HODNOCENÍ</span>
                  <select name="rating" defaultValue="5" className={styles.input}>
                    {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}{'☆'.repeat(5 - n)} ({n})</option>)}
                  </select>
                </label>
                <label className={`${styles.field} ${styles.grow}`}>
                  <span className="t-label muted">KOMENTÁŘ (NEPOVINNÝ)</span>
                  <input name="comment" maxLength={500} className={styles.input} placeholder="Jak proběhl nákup?" />
                </label>
                <Button type="submit" variant="secondary">Ohodnotit prodejce</Button>
              </form>
            ) : null}
            {reviewed.has(o.id) ? <p className="t-small muted">Prodejce jste ohodnotili, děkujeme.</p> : null}
          </OrderCard>
        )) : <p className="muted">Zatím jste nic nekoupili. <Link href="/karty">Procházet karty</Link></p>}
      </section>

      <section className={styles.section}>
        <h2 className="t-heading-m">Prodeje</h2>
        {sold.length ? sold.map((o) => (
          <OrderCard key={o.id} order={o} counterpart={`Kupující: ${(o.buyer_id && names.get(o.buyer_id)) || 'smazaný účet'}`}>
            {o.status === 'paid' ? (
              <form action={setOrderStatus}>
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="status" value="shipped" />
                <Button type="submit">Označit jako odeslané</Button>
              </form>
            ) : null}
          </OrderCard>
        )) : <p className="muted">Zatím nemáte žádné prodeje. <Link href="/prodat">Vystavit kartu</Link></p>}
      </section>
    </div>
  );
}

function OrderCard({ order, counterpart, children }: { order: OrderRow; counterpart: string; children?: React.ReactNode }) {
  return (
    <article className={styles.order}>
      <div className={styles.head}>
        <div>
          <p className={styles.status}>{STATUS[order.status] ?? order.status}</p>
          <p className="t-small muted">{counterpart} · {formatDate(order.created_at)} · <span className="code">{order.id.slice(0, 8).toUpperCase()}</span></p>
        </div>
        <Price amount={order.total_czk} />
      </div>
      <ul className={styles.items}>
        {order.order_items.map((i, n) => (
          <li key={n}>
            <CardThumb
              image={thumbUrl(i.cards?.image_url ?? undefined)}
              preview={i.cards?.image_url ?? undefined}
              color={i.cards?.game_id ? `var(--game-${i.cards.game_id}-art)` : undefined}
            />
            {i.cards ? <Link href={`/karty/${i.cards.slug}`}>{i.cards.name}</Link> : 'Karta'}
            {i.condition ? <> <span className="code">{i.condition}</span></> : null}
            <span className="muted"> · {i.quantity}&nbsp;ks</span>
            <Price amount={i.price_czk * i.quantity} />
          </li>
        ))}
        <li className="muted">Doprava <Price amount={order.shipping_czk} /></li>
      </ul>
      {children ? <div className={styles.actions}>{children}</div> : null}
    </article>
  );
}
