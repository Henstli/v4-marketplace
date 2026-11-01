import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { getGame } from '@/lib/games';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { retryCatalog } from './actions';

export const metadata: Metadata = { title: 'Přehled webu' };

type Props = { searchParams: Promise<{ obdobi?: string; ok?: string; chyba?: string }> };

const PERIODS = [
  { id: 'den', label: 'Den', days: 1, prev: 'proti včerejšku' },
  { id: 'tyden', label: 'Týden', days: 7, prev: 'proti minulému týdnu' },
  { id: 'mesic', label: 'Měsíc', days: 30, prev: 'proti minulému měsíci' },
] as const;

// Stejné pořadí her jako všude na webu.
const ORDER = ['pokemon', 'magic', 'riftbound', 'lorcana', 'onepiece', 'cyberpunk', 'sport'];

type Overview = {
  users: number; users_prev: number; listings: number; listings_prev: number; orders: number; orders_prev: number;
  reports_open: number; cases_open: number; plus: number; pro: number; users_total: number; listings_active: number;
};
type CatalogRow = {
  game_id: string; sets: number; checked_24h: number; errors: number; last_check: string | null;
  last_error: string | null; cards: number; no_image: number;
};

const n = (x: number) => x.toLocaleString('cs-CZ');
const WHEN = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' });
const TIME = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' });
const DAY = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Europe/Prague' });

function when(iso: string | null) {
  if (!iso) return 'zatím ne';
  const d = new Date(iso);
  return DAY.format(d) === DAY.format(new Date()) ? `dnes ${TIME.format(d)}` : WHEN.format(d);
}

function Diff({ now, prev, label }: { now: number; prev: number; label: string }) {
  const d = now - prev;
  if (!d) return <em style={{ color: 'var(--ink-muted)' }}>stejně {label}</em>;
  return <em className={d < 0 ? 'down' : undefined}>{d > 0 ? '+' : '−'}{n(Math.abs(d))} {label}</em>;
}

/** Přehled webu (jen správce): čísla za den, týden a měsíc a stav nočních importů katalogu. */
export default async function SiteOverviewPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/sprava/prehled');
  if (!user.isAdmin) notFound();

  const { obdobi, ok, chyba } = await searchParams;
  const period = PERIODS.find((p) => p.id === obdobi) ?? PERIODS[0];
  const supabase = await createClient();
  const [{ data: ov, error }, { data: cat }] = await Promise.all([
    supabase.rpc('admin_site_overview', { p_days: period.days }),
    supabase.rpc('admin_catalog_status'),
  ]);
  const o = (ov ?? null) as Overview | null;
  const rows = ((cat ?? []) as CatalogRow[]).sort((a, b) => ORDER.indexOf(a.game_id) - ORDER.indexOf(b.game_id));
  const back = `/sprava/prehled${period.id === 'den' ? '' : `?obdobi=${period.id}`}`;

  return (
    <div className="container section" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <h1 className="t-heading-l">Přehled webu</h1>
        <p className="muted">Jak web roste a jestli běží noční kontrola katalogu. Vidí jen správce.</p>
      </div>
      {chyba ? <p role="alert" style={{ color: 'var(--danger)' }}>{chyba}</p> : null}
      {ok ? <p role="status" style={{ color: 'var(--accent)' }}>{ok}</p> : null}

      <div>
        <nav className="tz-ov-seg" aria-label="Období">
          {PERIODS.map((p) => (
            <Link key={p.id} href={p.id === 'den' ? '/sprava/prehled' : `/sprava/prehled?obdobi=${p.id}`} aria-current={p.id === period.id ? 'page' : undefined}>{p.label}</Link>
          ))}
        </nav>
        {o ? (
          <div className="tz-ov-tiles">
            <div className="tz-ov-tile"><span>Noví uživatelé</span><b>{n(o.users)}</b><Diff now={o.users} prev={o.users_prev} label={period.prev} /></div>
            <div className="tz-ov-tile"><span>Nové nabídky</span><b>{n(o.listings)}</b><Diff now={o.listings} prev={o.listings_prev} label={period.prev} /></div>
            <div className="tz-ov-tile"><span>Objednávky</span><b>{n(o.orders)}</b><Diff now={o.orders} prev={o.orders_prev} label={period.prev} /></div>
            <div className="tz-ov-tile"><span>Otevřená hlášení</span><b>{n(o.reports_open)}</b><em style={{ color: 'var(--ink-muted)' }}>případy podpory: {n(o.cases_open)}</em></div>
            <div className="tz-ov-tile"><span>Předplatitelé</span><b>{n(o.plus + o.pro)}</b><em>{n(o.pro)} Pro · {n(o.plus)} Plus</em></div>
            <div className="tz-ov-tile"><span>Celkem</span><b>{n(o.users_total)}</b><em style={{ color: 'var(--ink-muted)' }}>uživatelů · {n(o.listings_active)} aktivních nabídek</em></div>
          </div>
        ) : (
          <p className="muted" style={{ margin: 'var(--space-4) 0 var(--space-6)' }}>Čísla se nepodařilo načíst{error ? `: ${error.message}` : ''}.</p>
        )}
      </div>

      <section>
        <p className="tz-ov-h">Katalog a importy</p>
        {rows.map((r) => (
          <div key={r.game_id} className="tz-ov-row">
            <b>{getGame(r.game_id)?.name ?? r.game_id}</b>
            <span className="muted">kontrola {when(r.last_check)}</span>
            <span className="muted">{n(r.checked_24h)} z {n(r.sets)} sad za 24 h · {n(r.cards)} karet</span>
            {r.errors ? (
              <span className="err" title={r.last_error ?? undefined}>{n(r.errors)} {r.errors === 1 ? 'sada s chybou' : r.errors < 5 ? 'sady s chybou' : 'sad s chybou'}</span>
            ) : r.no_image ? (
              <span className="muted">{n(r.no_image)} bez obrázku</span>
            ) : (
              <span className="muted">bez chyb</span>
            )}
            {r.errors ? (
              <form action={retryCatalog}>
                <input type="hidden" name="game" value={r.game_id} />
                <input type="hidden" name="back" value={back} />
                <Button type="submit" variant="secondary">Spustit znovu</Button>
              </form>
            ) : <span />}
          </div>
        ))}
      </section>
    </div>
  );
}
