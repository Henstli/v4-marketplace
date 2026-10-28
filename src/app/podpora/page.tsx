import type { Metadata } from 'next';
import { ContactForm, type OrderOption } from '@/components/support/ContactForm';
import { getCurrentUser } from '@/lib/auth';
import { formatPrice } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { SUPPORT_TOPICS, type SupportTopic } from '@/lib/support';
import styles from './contact.module.css';

export const metadata: Metadata = { title: 'Napsat podpoře' };

type Props = { searchParams: Promise<{ objednavka?: string; tema?: string }> };

// Napsat podpoře (DS Support › Napsat podpoře, DSA čl. 12): zpráva sama založí případ ve frontě podpory.
export default async function ContactPage({ searchParams }: Props) {
  const [{ objednavka, tema }, user] = await Promise.all([searchParams, getCurrentUser()]);
  let orders: OrderOption[] = [];
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase.from('orders').select('number, buyer_id, seller_id, total_czk')
      .order('created_at', { ascending: false }).limit(20);
    const rows = (data ?? []) as Array<{ number: number; buyer_id: string | null; seller_id: string | null; total_czk: number }>;
    const ids = [...new Set(rows.map((o) => (o.buyer_id === user.id ? o.seller_id : o.buyer_id)).filter((x): x is string => !!x))];
    const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] };
    const name = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]));
    orders = rows.map((o) => {
      const other = o.buyer_id === user.id ? o.seller_id : o.buyer_id;
      return { number: o.number, label: `č. ${o.number} · ${(other && name.get(other)) || 'smazaný účet'} · ${formatPrice(o.total_czk)}` };
    });
  }
  const order = Number(objednavka) || undefined;
  const topic = (SUPPORT_TOPICS.find((t) => t.id === tema)?.id ?? (order ? 'order' : undefined)) as SupportTopic | undefined;

  return (
    <div className={`container ${styles.page}`}>
      <h1 className="t-heading-l">Napsat podpoře</h1>
      <p className="muted">
        Odpovídáme do 2 dnů, i o víkendu. S problémem u objednávky (karta nepřišla, prodejce nereaguje) je rychlejší
        „Nahlásit problém“ přímo u objednávky.
      </p>
      <div className="panel">
        <ContactForm email={user?.email ?? null} orders={orders} defaultTopic={topic} defaultOrder={order} />
      </div>
    </div>
  );
}
