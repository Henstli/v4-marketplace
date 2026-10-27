'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { unreadCount } from '@/app/zpravy/actions';

/** Zprávy v hlavičce s počtem nepřečtených konverzací (obnovuje se každých 30 s a při přechodu). */
export function MessagesLink({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  const pathname = usePathname();
  useEffect(() => setCount(initial), [initial]);
  useEffect(() => {
    let alive = true;
    const load = () => { if (!document.hidden) unreadCount().then((n) => { if (alive) setCount(n); }).catch(() => {}); };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [pathname]);
  return (
    <Link
      href="/zpravy"
      className="tz-btn tz-btn-ghost tz-btn-md tz-msgs-btn"
      aria-label={count ? `Zprávy, ${count} nepřečtené` : 'Zprávy'}
      aria-current={pathname.startsWith('/zpravy') ? 'page' : undefined}
    >
      <span className="tz-msgs-ico">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        {count ? <span className="tz-msgs-badge" aria-hidden="true">{count > 9 ? '9+' : count}</span> : null}
      </span>
      <span className="tz-msgs-label">Zprávy</span>
    </Link>
  );
}
