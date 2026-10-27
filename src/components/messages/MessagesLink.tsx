'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { UnreadSummary } from '@/app/zpravy/actions';
import { loadUnread } from '@/lib/unread-client';
import { HeaderIcon } from '@/components/site/HeaderIcon';

const POLL_MS = 8_000;
/** Na schované kartě stačí kontrola jednou za minutu (počet v názvu záložky). */
const HIDDEN_POLL_MS = 60_000;
const TOAST_MS = 8_000;

/**
 * Zprávy v hlavičce s počtem nepřečtených konverzací. Ptá se přímo Supabase (ne Vercelu) každých 8 s (a hned po návratu na kartu) a při přechodu;
 * když přibude nepřečtená zpráva, vyskočí vpravo dole upozornění (DS Messages) a počet je i v názvu záložky.
 */
export function MessagesLink({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  const [toast, setToast] = useState<UnreadSummary['latest']>(null);
  const seen = useRef<string | null>(null);
  const pending = useRef<UnreadSummary['latest']>(null);
  const pathname = usePathname();
  const path = useRef(pathname);
  path.current = pathname;

  useEffect(() => setCount(initial), [initial]);
  useEffect(() => {
    let alive = true;
    let lastLoad = 0;
    const load = () => {
      lastLoad = Date.now();
      loadUnread().then((s) => {
        if (!alive) return;
        setCount(s.count);
        const key = s.latest ? `${s.latest.from}:${s.latest.at}` : null;
        // První načtení jen zapamatuje stav, upozornění až na zprávu, která přišla potom.
        // Na schované kartě počkáme, až se uživatel vrátí, aby upozornění neprošvihl.
        if (seen.current !== null && key && key !== seen.current && s.latest && !path.current.startsWith(`/zpravy/${s.latest.from}`)) {
          pending.current = s.latest;
        }
        if (pending.current && !document.hidden) {
          setToast(pending.current);
          pending.current = null;
        }
        seen.current = key ?? '';
      }).catch(() => {});
    };
    // Po návratu na kartu nebo do okna hned zkontrolovat, ne až za celý interval.
    const wake = () => { if (!document.hidden && Date.now() - lastLoad > 2_000) load(); };
    load();
    const t = setInterval(() => { if (!document.hidden || Date.now() - lastLoad > HIDDEN_POLL_MS) load(); }, POLL_MS);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    // Otevřená konverzace se právě přečetla (Thread): počet hned znovu.
    window.addEventListener('v4-messages-read', load);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('v4-messages-read', load);
    };
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
