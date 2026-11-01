'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ShopLogo, shopStyle } from '@/components/trezor';
import { formatDateTime } from '@/lib/format';
import { lastConversationChange } from '@/lib/unread-client';
import type { ConversationItem } from '@/lib/messages';
import type { Presence } from '@/lib/profile-card';
import { FriendsPanel, type FriendRow } from './FriendsPanel';
import styles from './messages.module.css';

/** Dva sloupce; na telefonu buď seznam (/zpravy), nebo otevřená konverzace. */
export function ChatShell({ list, children }: { list: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Nové zprávy: každých 5 s (a hned po návratu na kartu) se přímo Supabase zeptá na čas poslední změny
  // v konverzacích; stránka se obnoví přes Vercel, jen když se opravdu něco změnilo.
  useEffect(() => {
    let last: string | null | undefined;
    let alive = true;
    const check = () => {
      if (document.hidden) return;
      lastConversationChange().then((at) => {
        if (!alive) return;
        if (last !== undefined && at !== last) router.refresh();
        last = at;
      }).catch(() => {});
    };
    // Hned po otevření Zpráv: seznam mohl přijít z mezipaměti prohlížeče.
    router.refresh();
    check();
    const t = setInterval(check, 5_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [router]);
  return (
    <div className={styles.chat} data-open={pathname !== '/zpravy' ? '' : undefined}>
      {list}
      {children}
    </div>
  );
}

// Hledání bez diakritiky a velikosti písmen.
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Řádek konverzace; u přítele s tečkou stavu na avataru. */
export function ConvRow({ c, presence }: { c: ConversationItem; presence?: Presence }) {
  const pathname = usePathname();
  const href = c.other ? `/zpravy/${c.other.id}` : null;
  // Otevřená konverzace je přečtená hned po kliknutí, i než se seznam načte znovu.
  const unread = c.unread && pathname !== href;
  const inner = (
    <>
      <span className={styles.fava} style={shopStyle(c.other?.color ?? 'blue')}>
        <ShopLogo name={c.other?.name ?? '?'} image={c.other?.logo} size={40} />
        {presence ? <i className={styles.presence} data-p={presence} /> : null}
      </span>
      <span className={styles.convText}>
        <span className={styles.convName}>{c.other?.name ?? 'Smazaný účet'}</span>
        <span className={styles.convLast}>{c.lastMine ? 'Vy: ' : ''}{c.lastBody}</span>
      </span>
      <span className={styles.convSide}>
        {formatDateTime(c.lastAt)}
        {unread ? (
          <span className={styles.count} aria-label={`${c.unreadCount} nepřečtené`}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>
        ) : null}
      </span>
    </>
  );
  const cls = `${styles.conv} ${unread ? styles.unread : ''}`;
  return href ? (
    <Link href={href} className={cls} aria-current={pathname === href ? 'page' : undefined}>{inner}</Link>
  ) : <div className={cls}>{inner}</div>;
}

/**
 * Levý sloupec Zpráv se dvěma záložkami: Přátelé (žádosti, pak přátelé podle posledního chatu, slouží i k psaní)
 * a Obchody (konverzace s lidmi, kteří nejsou přátelé, hlavně kvůli objednávkám).
 */
export function ConversationList({ items, friends = [] }: { items: ConversationItem[]; friends?: FriendRow[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const friendIds = new Set(friends.filter((f) => f.status === 'friends').map((f) => f.id));
  const isFriend = (c: ConversationItem) => !!c.other && friendIds.has(c.other.id);
  const sorted = [...items].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const friendConvs = sorted.filter(isFriend);
  const shopConvs = sorted.filter((c) => !isFriend(c));
  const openId = pathname.startsWith('/zpravy/') ? pathname.slice(8) : null;
  // Výchozí záložka: kde je otevřená konverzace, jinak kde se naposledy něco dělo.
  const first: 'friends' | 'shop' = params.has('pratele') ? 'friends' : params.has('obchody') ? 'shop'
    : openId ? (friendIds.has(openId) ? 'friends' : 'shop')
    : (shopConvs[0]?.lastAt ?? '') > (friendConvs[0]?.lastAt ?? '') ? 'shop' : 'friends';
  const [tab, setTab] = useState(first);
  const [q, setQ] = useState('');
  const needle = fold(q.trim());
  const match = (s: string) => !needle || fold(s).includes(needle);
  const requests = friends.filter((f) => f.status === 'incoming').length;
  const unreadOf = (list: ConversationItem[]) => list.filter((c) => c.unread && c.other?.id !== openId).length;
  const fBadge = requests + unreadOf(friendConvs);
  const sBadge = unreadOf(shopConvs);
  const onFriends = tab === 'friends';
  const shown = shopConvs.filter((c) => match(`${c.other?.name ?? ''} ${c.lastBody}`));
  return (
    <nav className={styles.list} aria-label={onFriends ? 'Přátelé' : 'Obchody'}>
      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" className={styles.tab} aria-selected={onFriends} onClick={() => setTab('friends')}>
          Přátelé{fBadge ? <span className={styles.count}>{fBadge}</span> : null}
        </button>
        <button type="button" role="tab" className={styles.tab} aria-selected={!onFriends} onClick={() => setTab('shop')}>
          Obchody{sBadge ? <span className={styles.count}>{sBadge}</span> : null}
        </button>
      </div>
      {items.length || friends.length ? (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={onFriends ? 'Hledat přátele' : 'Hledat v obchodech'}
          aria-label={onFriends ? 'Hledat přátele' : 'Hledat v obchodech'}
          className={styles.search}
        />
      ) : null}
      <div className={styles.convs}>
      {onFriends ? <FriendsPanel items={friends} convs={friendConvs} q={match} /> : shown.length ? shown.map((c) => <ConvRow key={c.id} c={c} />) : (
        <p className={`muted t-small ${styles.listEmpty}`}>{shopConvs.length ? 'Nic nenalezeno.' : 'Zatím žádné zprávy. Konverzace s prodejci a kupujícími, kteří nejsou tvoji přátelé, se objeví tady.'}</p>
      )}
      </div>
    </nav>
  );
}
