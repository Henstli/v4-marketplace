import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { PAID_PLANS, PLANS, toPlan } from '@/lib/plans';
import { setPlan } from './actions';
import styles from '../karty/admin.module.css';

export const metadata: Metadata = { title: 'Předplatné prodejců' };

type Props = { searchParams: Promise<{ chyba?: string; ok?: string }> };

type Subscriber = { user_id: string; display_name: string; email: string; plan: string; granted_at: string; note: string | null };

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
          Tři tarify: zdarma a dva placené. Zatím bez placení, tarif přiděluje správce. Výhody tarifů se nastavují
          v kódu webu (soubor src/lib/plans.ts); teď mají oba placené tarify hromadné nahrávání bez limitu, zdarma {PLANS.free.importRows} řádků najednou. <Link href="/sprava/karty">Schvalování karet</Link>
        </p>
      </div>
      {chyba ? <p className={styles.error} role="alert">{chyba}</p> : null}
      {ok ? <p className="muted" role="status">{ok}</p> : null}

      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Nastavit tarif</h2>
        <form action={setPlan} className={styles.reject}>
          <input name="email" type="email" required placeholder="E-mail prodejce" className={styles.reason} />
          <select name="plan" defaultValue="tier1" className={styles.reason} aria-label="Tarif">
            {PAID_PLANS.map((p) => <option key={p} value={p}>{PLANS[p].name}</option>)}
            <option value="free">{PLANS.free.name} (odebrat předplatné)</option>
          </select>
          <input name="note" maxLength={200} placeholder="Poznámka, např. zakládající obchod" className={styles.reason} />
          <Button type="submit">Uložit tarif</Button>
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
                  <div className="t-small muted">{PLANS[toPlan(s.plan)].name} · {s.email} · od {formatDate(s.granted_at)}{s.note ? ` · ${s.note}` : ''}</div>
                </div>
                <form action={setPlan}>
                  <input type="hidden" name="email" value={s.email} />
                  <input type="hidden" name="plan" value="free" />
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
