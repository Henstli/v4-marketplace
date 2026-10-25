import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured, SUPABASE_URL } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { approveSubmission, rejectSubmission } from './actions';
import styles from './admin.module.css';

export const metadata: Metadata = { title: 'Schvalování karet' };

type Props = { searchParams: Promise<{ chyba?: string }> };

const DATE = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

export default async function ReviewPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/sprava/karty');
  if (!user.isAdmin) notFound();

  const { chyba } = await searchParams;
  const supabase = await createClient();
  const fields = 'id, player, season, manufacturer, set_name, number, variant, note, image_path, status, reject_reason, created_at, reviewed_at, profiles!card_submissions_submitted_by_fkey(display_name), cards(slug)';
  const [{ data: pending }, { data: done }] = await Promise.all([
    supabase.from('card_submissions').select(fields).eq('status', 'pending').order('created_at').limit(100),
    supabase.from('card_submissions').select(fields).neq('status', 'pending').order('reviewed_at', { ascending: false }).limit(20),
  ]);
  const photo = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/card-submissions/${path}`;
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

  return (
    <div className={`container ${styles.page}`}>
      <div>
        <h1 className="t-heading-l">Schvalování karet</h1>
        <p className="muted">Návrhy sportovních karet od prodejců. Schválená karta se hned objeví v katalogu.</p>
      </div>
      {chyba ? <p className={styles.error} role="alert">{chyba}</p> : null}

      <section>
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Čeká na schválení ({pending?.length ?? 0})</h2>
        {pending?.length ? (
          <div className={styles.list}>
            {pending.map((s) => (
              <article key={s.id} className={styles.item}>
                <a href={photo(s.image_path)} target="_blank" rel="noreferrer" className={styles.photo}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo(s.image_path)} alt={`Fotka karty ${s.player}`} />
                </a>
                <div className={styles.info}>
                  <h3 className="t-heading-m">{s.player}</h3>
                  <dl className={styles.facts}>
                    <div><dt className="t-small muted">Sezóna</dt><dd>{s.season}</dd></div>
                    <div><dt className="t-small muted">Výrobce</dt><dd>{s.manufacturer}</dd></div>
                    <div><dt className="t-small muted">Sada</dt><dd>{s.set_name}</dd></div>
                    <div><dt className="t-small muted">Číslo</dt><dd className="code">{s.number}</dd></div>
                    <div><dt className="t-small muted">Varianta</dt><dd>{s.variant || 'Base'}</dd></div>
                  </dl>
                  {s.note ? <p className="t-small">Poznámka: {s.note}</p> : null}
                  <p className="t-small muted">
                    Navrhl(a) {one(s.profiles)?.display_name ?? 'prodejce'} · {DATE.format(new Date(s.created_at))}
                  </p>
                  <div className={styles.actions}>
                    <form action={approveSubmission}>
                      <input type="hidden" name="id" value={s.id} />
                      <Button type="submit">Schválit</Button>
                    </form>
                    <form action={rejectSubmission} className={styles.reject}>
                      <input type="hidden" name="id" value={s.id} />
                      <input name="reason" maxLength={300} placeholder="Důvod zamítnutí (uvidí ho prodejce)" className={styles.reason} />
                      <Button type="submit" variant="ghost">Zamítnout</Button>
                    </form>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Nic nečeká. Až někdo navrhne kartu, objeví se tady.</p>
        )}
      </section>

      {done?.length ? (
        <section className="panel">
          <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Naposledy vyřízené</h2>
          <div className={styles.done}>
            {done.map((s) => {
              const card = one(s.cards);
              return (
                <div key={s.id} className={styles.doneRow}>
                  <div>
                    {card ? <Link href={`/karty/${card.slug}`}>{s.player}</Link> : s.player}
                    <div className="t-small muted">
                      {s.season} {s.manufacturer} {s.set_name} · <span className="code">{s.number}</span>
                      {s.status === 'rejected' && s.reject_reason ? ` · ${s.reject_reason}` : ''}
                    </div>
                  </div>
                  <span className="t-small muted">{s.status === 'approved' ? 'Schváleno' : 'Zamítnuto'}</span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
