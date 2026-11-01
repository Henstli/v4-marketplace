'use client';

// Přátelé ve Zprávách (záložka vedle Konverzací): žádosti, přátelé (nejdřív online) a odeslané žádosti.
// Klik na přítele otevře konverzaci s ním. Přidávají se na profilu tlačítkem Přidat přítele.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { ShopLogo, shopStyle } from '@/components/trezor';
import { friendAction } from '@/app/ucet/pratele-actions';
import { plural } from '@/lib/format';
import type { Presence } from '@/lib/profile-card';
import styles from './messages.module.css';

export interface FriendRow {
  id: string;
  name: string;
  avatar: string | null;
  presence: Presence;
  /** „Sběratelka · Ostrava“ */
  sub: string;
  trades: number;
  status: 'friends' | 'incoming' | 'outgoing';
}

const CHECK = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const X = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const USER = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>;
const PRESENCE: Record<Presence, string> = { online: 'Online', offline: 'Offline', dnd: 'Nerušit' };

function Ava({ f }: { f: FriendRow }) {
  return (
    <span className={styles.fava} style={shopStyle('blue')}>
      <ShopLogo name={f.name} image={f.avatar} size={40} />
      <i className={styles.presence} data-p={f.presence} title={PRESENCE[f.presence]} />
    </span>
  );
}

function Act({ id, op, label, children, primary }: { id: string; op: Parameters<typeof friendAction>[1]; label: string; children: React.ReactNode; primary?: boolean }) {
  const [busy, start] = useTransition();
  return (
    <button type="button" className={styles.fbtn} data-primary={primary ? '' : undefined} aria-label={label} title={label} disabled={busy}
      onClick={(e) => { e.preventDefault(); start(async () => { await friendAction(id, op); }); }}>{children}</button>
  );
}

export function FriendsPanel({ items, q }: { items: FriendRow[]; q: (s: string) => boolean }) {
  const pathname = usePathname();
  const shown = items.filter((f) => q(`${f.name} ${f.sub}`));
  const incoming = shown.filter((f) => f.status === 'incoming');
  const outgoing = shown.filter((f) => f.status === 'outgoing');
  const rank = { online: 0, dnd: 1, offline: 2 };
  const friends = shown.filter((f) => f.status === 'friends').sort((a, b) => rank[a.presence] - rank[b.presence] || a.name.localeCompare(b.name, 'cs'));
  if (!items.length) {
    return <p className={`muted t-small ${styles.listEmpty}`}>Zatím žádní přátelé. Přidáš je na jejich profilu tlačítkem Přidat přítele.</p>;
  }
  if (!shown.length) return <p className={`muted t-small ${styles.listEmpty}`}>Nic nenalezeno.</p>;
  return (
    <>
      {incoming.length ? <p className={styles.fhead}>Žádosti · {incoming.length}</p> : null}
      {incoming.map((f) => (
        <div key={f.id} className={`${styles.conv} ${styles.freq}`}>
          <Ava f={f} />
          <Link href={`/prodejci/${f.id}`} className={styles.convText}>
            <span className={styles.convName}>{f.name}</span>
            <span className={styles.convLast}>{f.sub}</span>
          </Link>
          <span className={styles.facts}>
            <Act id={f.id} op="accept" label="Přijmout" primary>{CHECK}</Act>
            <Act id={f.id} op="decline" label="Odmítnout">{X}</Act>
          </span>
        </div>
      ))}
      {friends.length ? <p className={styles.fhead}>Přátelé · {friends.length}</p> : null}
      {friends.map((f) => {
        const href = `/zpravy/${f.id}`;
        return (
          <div key={f.id} className={`${styles.conv} ${styles.frow}`} aria-current={pathname === href ? 'page' : undefined}>
            <Ava f={f} />
            <Link href={href} className={`${styles.convText} ${styles.fmain}`} aria-label={`Napsat ${f.name}`}>
              <span className={styles.convName}>{f.name}</span>
              <span className={styles.convLast}>{f.trades ? plural(f.trades, ['společný obchod', 'společné obchody', 'společných obchodů']) : f.sub}</span>
            </Link>
            <span className={styles.facts}><Link href={`/prodejci/${f.id}`} className={styles.fbtn} aria-label={`Profil ${f.name}`} title="Profil">{USER}</Link></span>
          </div>
        );
      })}
      {outgoing.length ? <p className={styles.fhead}>Odeslané · {outgoing.length}</p> : null}
      {outgoing.map((f) => (
        <div key={f.id} className={styles.conv}>
          <Ava f={f} />
          <Link href={`/prodejci/${f.id}`} className={styles.convText}>
            <span className={styles.convName}>{f.name}</span>
            <span className={styles.convLast}>Čeká na přijetí</span>
          </Link>
          <span className={styles.facts}><Act id={f.id} op="remove" label="Zrušit žádost">{X}</Act></span>
        </div>
      ))}
      <p className={`muted t-small ${styles.listEmpty}`}>Další přátele přidáš na jejich profilu.</p>
    </>
  );
}
