import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { SubmissionForm } from './SubmissionForm';
import styles from '../sell.module.css';

export const metadata: Metadata = { title: 'Navrhnout kartu' };

const STATUS: Record<string, { label: string; className?: string }> = {
  pending: { label: 'Čeká na schválení' },
  approved: { label: 'Schváleno', className: styles.ok },
  rejected: { label: 'Zamítnuto', className: styles.error },
};

export default async function NewCardPage() {
  if (!isSupabaseConfigured()) {
    return <ComingSoon title="Navrhnout kartu" text="Návrhy karet zapneme po připojení databáze." />;
  }
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/prodat/nova-karta');

  const supabase = await createClient();
  const { data: mine } = await supabase
    .from('card_submissions')
    .select('id, player, season, manufacturer, set_name, number, variant, status, reject_reason, created_at, cards(slug)')
    .eq('submitted_by', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className={`container ${styles.page}`}>
      <div>
        <h1 className="t-heading-l">Navrhnout sportovní kartu</h1>
        <p className="muted">
          Hokejové a další sportovní karty zatím nemají veřejný katalog. Pokud kartu v <Link href="/prodat">katalogu</Link> nenajdete,
          vyplňte údaje z karty a přiložte fotku. Po schválení ji přidáme do katalogu a můžete ji vystavit.
        </p>
      </div>

      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Údaje o kartě</h2>
        <SubmissionForm userId={user.id} />
      </section>

      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Moje návrhy</h2>
        {mine?.length ? (
          <div className={styles.list}>
            {mine.map((s) => {
              const card = (Array.isArray(s.cards) ? s.cards[0] : s.cards) as { slug: string } | null;
              const status = STATUS[s.status] ?? STATUS.pending;
              return (
                <div key={s.id} className={styles.row}>
                  <div>
                    <span className={styles.rowName}>{s.player}</span>
                    <div className="t-small muted">
                      {s.season} {s.manufacturer} {s.set_name} · <span className="code">{s.number}</span>
                      {s.variant ? ` · ${s.variant}` : ''}
                    </div>
                    {s.status === 'rejected' && s.reject_reason ? <div className="t-small muted">Důvod: {s.reject_reason}</div> : null}
                  </div>
                  <span className={`t-small ${status.className ?? 'muted'}`}>{status.label}</span>
                  {card ? <Link href={`/prodat?karta=${card.slug}`} className="t-small">Vystavit</Link> : <span />}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">Zatím jste žádnou kartu nenavrhli.</p>
        )}
      </section>
    </div>
  );
}
