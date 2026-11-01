'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ShopLogo, shopStyle } from '@/components/trezor';
import { formatDateTime } from '@/lib/format';
import { lastConversationChange } from '@/lib/unread-client';
import type { ConversationItem } from '@/lib/messages';
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

export function ConversationList({ items, friends = [] }: { items: ConversationItem[]; friends?: FriendRow[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [tab, setTab] = useState<'conv' | 'friends'>(params.has('pratele') ? 'friends' : 'conv');
  const [q, setQ] = useState('');
  const needle = fold(q.trim());
  const match = (s: string) => !needle || fold(s).includes(needle);
  const shown = needle ? items.filter((c) => match(`${c.other?.name ?? ''} ${c.lastBody}`)) : items;
  const requests = friends.filter((f) => f.status === 'incoming').length;
  const onFriends = tab === 'friends';
  return (
    <nav className={styles.list} aria-label={onFriends ? 'Přátelé' : 'Konverzace'}>
      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" className={styles.tab} aria-selected={!onFriends} onClick={() => setTab('conv')}>Konverzace</button>
        <button type="button" role="tab" className={styles.tab} aria-selected={onFriends} onClick={() => setTab('friends')}>
          Přátelé{requests ? <span className={styles.count} aria-label={`${requests} nové žádosti`}>{requests}</span> : null}
        </button>
      </div>
      {items.length || friends.length ? (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={onFriends ? 'Hledat přátele' : 'Hledat v konverzacích'}
          aria-label={onFriends ? 'Hledat přátele' : 'Hledat v konverzacích'}
          className={styles.search}
        />
      ) : null}
      <div className={styles.convs}>
      {onFriends ? <FriendsPanel items={friends} q={match} /> : shown.length ? shown.map((c) => {
        const href = c.other ? `/zpravy/${c.other.id}` : null;
        // Otevřená konverzace je přečtená hned po kliknutí, i než se seznam načte znovu.
        const unread = c.unread && pathname !== href;
        const inner = (
          <>
            <span style={shopStyle(c.other?.color ?? 'blue')}><ShopLogo name={c.other?.name ?? '?'} image={c.other?.logo} size={40} /></span>
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
          <Link key={c.id} href={href} className={cls} aria-current={pathname === href ? 'page' : undefined}>{inner}</Link>
        ) : <div key={c.id} className={cls}>{inner}</div>;
      }) : (
        <p className={`muted t-small ${styles.listEmpty}`}>{items.length ? 'Nic nenalezeno.' : 'Zatím žádné zprávy.'}</p>
      )}
      </div>
    </nav>
  );
}
