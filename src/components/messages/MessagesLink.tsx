'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { unreadSummary, type UnreadSummary } from '@/app/zpravy/actions';
import { HeaderIcon } from '@/components/site/HeaderIcon';

const POLL_MS = 15_000;
const TOAST_MS = 8_000;

/**
 * Zprávy v hlavičce s počtem nepřečtených konverzací. Obnovuje se každých 15 s a při přechodu;
 * když přibude nepřečtená zpráva, vyskočí vpravo dole upozornění (DS Messages) a počet je i v názvu záložky.
 */
export function MessagesLink({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  const [toast, setToast] = useState<UnreadSummary['latest']>(null);
  const seen = useRef<string | null>(null);
  const pathname = usePathname();
  const path = useRef(pathname);
  path.current = pathname;

  useEffect(() => setCount(initial), [initial]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      unreadSummary().then((s) => {
        if (!alive) return;
        setCount(s.count);
        const key = s.latest ? `${s.latest.from}:${s.latest.at}` : null;
        // První načtení jen zapamatuje stav, upozornění až na zprávu, která přišla potom.
        if (seen.current !== null && key && key !== seen.current && s.latest && !path.current.startsWith(`/zpravy/${s.latest.from}`)) {
          setToast(s.latest);
        }
        seen.current = key ?? '';
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [pathname]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // Počet nepřečtených v názvu záložky: „(2) …“.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = count ? `(${count > 9 ? '9+' : count}) ${base}` : base;
  }, [count, pathname]);

  return (
    <>
      <HeaderIcon
        href="/zpravy"
        icon="chat"
        label="Zprávy"
        count={count}
        countLabel={`${count} nepřečtené`}
        current={pathname.startsWith('/zpravy')}
      />
      {toast ? (
        <div className="tz-toast" role="status">
          <Link href={`/zpravy/${toast.from}`} className="tz-toast-link" onClick={() => setToast(null)}>
            <span className="tz-toast-ava" aria-hidden="true">{toast.name.slice(0, 1).toUpperCase()}</span>
            <span className="tz-toast-text">
              <strong>Nová zpráva od {toast.name}</strong>
              <span>{toast.body}</span>
            </span>
          </Link>
          <button type="button" className="tz-toast-close" onClick={() => setToast(null)} aria-label="Zavřít upozornění">×</button>
        </div>
      ) : null}
    </>
  );
}
