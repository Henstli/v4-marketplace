'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { unreadCount } from '@/app/zpravy/actions';
import { HeaderIcon } from '@/components/site/HeaderIcon';

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
    <HeaderIcon
      href="/zpravy"
      icon="chat"
      label="Zprávy"
      count={count}
      countLabel={`${count} nepřečtené`}
      current={pathname.startsWith('/zpravy')}
    />
  );
}
