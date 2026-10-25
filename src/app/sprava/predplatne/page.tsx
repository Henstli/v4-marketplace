import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { PAID_PLANS, PLANS, toPlan } from '@/lib/plans';
import { setPlan, setVerified } from './actions';
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
  const [{ data }, { data: verifiedRows }] = await Promise.all([
    supabase.rpc('admin_list_subscriptions'),
    supabase.from('seller_verifications').select('user_id, method, ico, verified_at, profiles(display_name)').order('verified_at', { ascending: false }),
  ]);
  const subscribers = (data ?? []) as Subscriber[];
  const verified = (verifiedRows ?? []).map((v) => {
    const p = (Array.isArray(v.profiles) ? v.profiles[0] : v.profiles) as { display_name: string } | null;
    return { id: v.user_id as string, name: p?.display_name ?? 'Prodejce', method: v.method as string, ico: v.ico as string | null, at: v.verified_at as string };
  });

  return (
    <div className={`container ${styles.page}`}>
      <div>
        <h1 className="t-heading-l">Předplatné prodejců</h1>
        <p className="muted">
          Tři tarify: {Object.values(PLANS).map((p) => p.name).join(', ')}. Zatím bez placení, tarif přiděluje správce.
          Výhody tarifů se nastavují v kódu webu (src/lib/plans.ts). Hromadné nahrávání nabídek mají:{' '}
          {Object.values(PLANS).filter((p) => p.bulkImport).map((p) => p.name).join(', ')}. <Link href="/sprava/karty">Schvalování karet</Link>
        </p>
      </div>
      {chyba ? <p className={styles.error} role="alert">{chyba}</p> : null}
      {ok ? <p className="muted" role="status">{ok}</p> : null}

      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Nastavit tarif</h2>
        <form action={setPlan} className={styles.reject}>
          <input name="email" type="email" required placeholder="E-mail prodejce" className={styles.reason} />
          <select name="plan" defaultValue="pro" className={styles.reason} aria-label="Tarif">
            {PAID_PLANS.map((p) => <option key={p} value={p}>{PLANS[p].name}</option>)}
            <option value="free">{PLANS.free.name} (odebrat předplatné)</option>
          </select>
          <input name="note" maxLength={200} placeholder="Poznámka, např. zakládající obchod" className={styles.reason} />
          <Button type="submit">Uložit tarif</Button>
        </form>
      </section>

      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-2)' }}>Ověření prodejce</h2>
        <p className="t-small muted" style={{ marginBottom: 'var(--space-4)' }}>
          Odznak „Ověřený prodejce“ se ukáže jen u placeného tarifu a s aspoň 95 % kladných hodnocení (od 5 hodnocení).
        </p>
        <form action={setVerified} className={styles.reject}>
          <input name="email" type="email" required placeholder="E-mail prodejce" className={styles.reason} />
          <select name="method" defaultValue="identity" className={styles.reason} aria-label="Způsob ověření">
            <option value="identity">Ověřená totožnost</option>
            <option value="ico">IČO (firma nebo živnost)</option>
            <option value="none">Odebrat ověření</option>
          </select>
          <input name="ico" inputMode="numeric" maxLength={10} placeholder="IČO (jen u ověření podle IČO)" className={styles.reason} />
          <Button type="submit">Uložit ověření</Button>
        </form>
        {verified.length ? (
          <div className={styles.done} style={{ marginTop: 'var(--space-4)' }}>
            {verified.map((v) => (
              <div key={v.id} className={styles.doneRow}>
                <div>
                  <Link href={`/prodejci/${v.id}`}>{v.name}</Link>
                  <div className="t-small muted">{v.method === 'ico' ? `IČO ${v.ico ?? ''}` : 'Totožnost'} · od {formatDate(v.at)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
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
