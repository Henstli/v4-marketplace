'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { ShopLogo, shopStyle } from '@/components/trezor';
import { formatDateTime } from '@/lib/format';
import type { ConversationItem } from '@/lib/messages';
import styles from './messages.module.css';

/** Dva sloupce; na telefonu buď seznam (/zpravy), nebo otevřená konverzace. */
export function ChatShell({ list, children }: { list: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Nové zprávy: obnovení každých 5 s, když je karta prohlížeče vidět, a hned po návratu na ni.
  useEffect(() => {
    const refresh = () => { if (!document.hidden) router.refresh(); };
    // Hned po otevření Zpráv: seznam mohl přijít z mezipaměti prohlížeče.
    refresh();
    const t = setInterval(refresh, 5_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [router]);
  return (
    <div className={styles.chat} data-open={pathname !== '/zpravy' ? '' : undefined}>
      {list}
      {children}
    </div>
  );
}

export function ConversationList({ items }: { items: ConversationItem[] }) {
  const pathname = usePathname();
  return (
    <nav className={styles.list} aria-label="Konverzace">
      {items.length ? items.map((c) => {
        const href = c.other ? `/zpravy/${c.other.id}` : null;
        const inner = (
          <>
            <span style={shopStyle(c.other?.color ?? 'blue')}><ShopLogo name={c.other?.name ?? '?'} image={c.other?.logo} size={36} /></span>
            <span className={styles.convText}>
              <span className={styles.convName}>{c.other?.name ?? 'Smazaný účet'}</span>
              <span className={styles.convLast}>{c.lastMine ? 'Vy: ' : ''}{c.lastBody}</span>
            </span>
            <span className={styles.convSide}>
              {formatDateTime(c.lastAt)}
              {c.unread ? (
                <span className={styles.count} aria-label={`${c.unreadCount} nepřečtené`}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>
              ) : null}
            </span>
          </>
        );
        const cls = `${styles.conv} ${c.unread ? styles.unread : ''}`;
        return href ? (
          <Link key={c.id} href={href} className={cls} aria-current={pathname === href ? 'page' : undefined}>{inner}</Link>
        ) : <div key={c.id} className={cls}>{inner}</div>;
      }) : (
        <p className={`muted t-small ${styles.listEmpty}`}>Zatím žádné zprávy.</p>
      )}
    </nav>
  );
}
