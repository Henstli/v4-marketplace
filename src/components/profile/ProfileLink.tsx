'use client';

// Jméno, po jehož kliknutí se otevře karta profilu v okně (DS Trezor › ProfileCard › Okno).
// Prostřední klik, Ctrl nebo Cmd otevřou celý profil jako odkaz.
import Link from 'next/link';
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ProfileCard } from '@/components/trezor';
import type { ProfileCardData } from '@/lib/profile-card';

export function ProfileLink({ id, className, children, shopHref }: { id: string; className?: string; children: ReactNode; shopHref?: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<ProfileCardData | null>(null);
  const [failed, setFailed] = useState(false);
  const href = `/prodejci/${id}`;

  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setFailed(false);
    dialog.current?.showModal();
    if (data?.id === id) return;
    fetch(`/api/profil/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ProfileCardData) => setData(d))
      .catch(() => setFailed(true));
  };

  return (
    <>
      <Link href={href} className={className} onClick={open}>{children}</Link>
      <dialog
        ref={dialog}
        className="tz-pcard-dialog"
        aria-label="Karta profilu"
        onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close(); }}
      >
        <div className="tz-pcard-dialog-body">
          <button type="button" className="tz-pcard-dialog-close" aria-label="Zavřít" onClick={() => dialog.current?.close()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          {data ? <ProfileCard data={data} /> : (
            <div className="tz-pcard tz-pcard-loading" aria-busy={!failed}>
              <div className="tz-pcard-in">{failed ? <p className="tz-pcard-fail">Kartu se nepodařilo načíst.</p> : null}</div>
            </div>
          )}
          <div className="tz-pcard-actions">
            <Link href={href} className="tz-btn tz-btn-md tz-btn-primary">Celý profil</Link>
            <Link href={`/zpravy/${id}`} className="tz-btn tz-btn-md tz-btn-secondary">Napsat zprávu</Link>
            {shopHref && !shopHref.startsWith('/prodejci/') ? <Link href={shopHref} className="tz-btn tz-btn-md tz-btn-secondary">Obchod</Link> : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
