import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { grantSubscription, revokeSubscription } from './actions';
import styles from '../karty/admin.module.css';

export const metadata: Metadata = { title: 'Předplatné prodejců' };

type Props = { searchParams: Promise<{ chyba?: string; ok?: string }> };

type Subscriber = { user_id: string; display_name: string; email: string; granted_at: string; note: string | null };

export default async function SubscriptionsPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/sprava/predplatne');
  if (!user.isAdmin) notFound();

  const { chyba, ok } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc('admin_list_subscriptions');
  const subscribers = (data ?? []) as Subscriber[];

  return (
    <div className={`container ${styles.page}`}>
      <div>
        <h1 className="t-heading-l">Předplatné prodejců</h1>
        <p className="muted">
          Zatím jeden tarif bez placení: předplatitel nahrává nabídky bez limitu {`(bez předplatného 100 řádků najednou)`}.
          Další výhody přibudou postupně. <Link href="/sprava/karty">Schvalování karet</Link>
        </p>
      </div>
      {chyba ? <p className={styles.error} role="alert">{chyba}</p> : null}
      {ok ? <p className="muted" role="status">{ok}</p> : null}

      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Přidělit předplatné</h2>
        <form action={grantSubscription} className={styles.reject}>
          <input name="email" type="email" required placeholder="E-mail prodejce" className={styles.reason} />
          <input name="note" maxLength={200} placeholder="Poznámka, např. zakládající obchod" className={styles.reason} />
          <Button type="submit">Přidělit</Button>
        </form>
      </section>

      <section>
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Předplatitelé ({subscribers.length})</h2>
        {subscribers.length ? (
          <div className={styles.done}>
            {subscribers.map((s) => (
              <div key={s.user_id} className={styles.doneRow}>
                <div>
                  <Link href={`/prodejci/${s.user_id}`}>{s.display_name}</Link>
                  <div className="t-small muted">{s.email} · od {formatDate(s.granted_at)}{s.note ? ` · ${s.note}` : ''}</div>
                </div>
                <form action={revokeSubscription}>
                  <input type="hidden" name="email" value={s.email} />
                  <Button type="submit" variant="danger">Odebrat</Button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Zatím nikdo nemá předplatné.</p>
        )}
      </section>
    </div>
  );
}
