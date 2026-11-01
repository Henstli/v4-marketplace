'use client';

// Řádek Napsat + tlačítko přítele na profilu (DS Trezor › ProfileMat, akce pod kartou).
// Tlačítko je stejně velké jako Napsat. Přidat přítele rovnou pošle žádost. Odesláno a Přátelé po kliknutí
// plynule přejedou přes Napsat a změní se na Zrušit žádost / Odebrat z přátel s křížkem (zpět);
// Nová žádost se roztáhne a rozdělí na Přijmout a Odmítnout. Klik mimo nebo Esc vrátí tlačítko zpět.
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { friendAction, type FriendStatus } from '@/app/ucet/pratele-actions';

const svg = (d: ReactNode, w = 2.2) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const PLUS = svg(<><circle cx="10" cy="8" r="4" /><path d="M3 21c0-4 3.5-6 7-6M18 13v8M14 17h8" /></>);
const CHECK = svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, 2.4);
const X = svg(<path d="M6 6l12 12M18 6L6 18" />, 2.4);
const CLOCK = svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
const USER = svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>);

const CLOSED: Record<FriendStatus, ReactNode> = {
  none: <>{PLUS}Přidat přítele</>, outgoing: <>{CLOCK}Odesláno</>, incoming: <>{USER}Nová žádost</>, friends: <>{CHECK}Přátelé</>,
};
const OPEN: Partial<Record<FriendStatus, ReactNode>> = { outgoing: 'Zrušit žádost', friends: 'Odebrat z přátel', incoming: <>{CHECK}Přijmout</> };

export function FriendRow({ other, initial, signedIn, writeHref, defaultOpen = false }: {
  other: string; initial: FriendStatus; signedIn: boolean; writeHref: string; defaultOpen?: boolean;
}) {
  const [status, setStatus] = useState(initial);
  const [open, setOpen] = useState(defaultOpen);
  const [pop, setPop] = useState(0);
  const [busy, start] = useTransition();
  const row = useRef<HTMLDivElement>(null);
  // Dva štítky přes sebe: nový přijede, starý odjede (plynulá výměna textu).
  const [labels, setLabels] = useState({ cur: defaultOpen ? OPEN[initial] : CLOSED[initial], prev: null as ReactNode, up: false, n: 0 });
  const show = (node: ReactNode, up: boolean) => setLabels((l) => ({ cur: node, prev: l.cur, up, n: l.n + 1 }));

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!row.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  });

  function close() { setOpen(false); show(CLOSED[status], false); }
  function become(next: FriendStatus) { setStatus(next); setOpen(false); show(CLOSED[next], false); setPop((n) => n + 1); }
  const run = (op: Parameters<typeof friendAction>[1], next: FriendStatus) => start(async () => {
    const prev = status;
    become(next);
    const r = await friendAction(other, op);
    if (typeof r !== 'string') become(prev);
    else if (r !== next) become(r);
  });

  const onMain = () => {
    if (status === 'none') return run('request', 'outgoing');
    if (!open) { setOpen(true); show(OPEN[status], true); return; }
    if (status === 'incoming') return run('accept', 'friends');
    run('remove', 'none');
  };
  const onSide = () => (status === 'incoming' ? run('decline', 'none') : close());

  return (
    <div className="tz-mat-frow" ref={row} data-open={open ? '' : undefined} data-s={status}>
      <Link href={writeHref} className="tz-btn tz-btn-md tz-btn-orange tz-mat-write" tabIndex={open ? -1 : undefined}>Napsat</Link>
      <div className="tz-mat-fr">
        {signedIn ? (
          <button key={pop} type="button" className="tz-btn tz-btn-md tz-mat-ghost tz-mat-fmain" data-pop={pop ? '' : undefined} disabled={busy} aria-expanded={status === 'none' ? undefined : open} onClick={onMain}>
            <span key={labels.n} className="tz-mat-flbl" data-first={labels.n ? undefined : ''}>{labels.cur}</span>
            {labels.prev ? <span key={labels.n - 1} className="tz-mat-flbl" data-out={labels.up ? 'up' : 'down'} aria-hidden="true">{labels.prev}</span> : null}
          </button>
        ) : (
          <a href="/prihlaseni" className="tz-btn tz-btn-md tz-mat-ghost tz-mat-fmain"><span className="tz-mat-flbl">{CLOSED.none}</span></a>
        )}
        <button type="button" className="tz-btn tz-btn-md tz-mat-ghost tz-mat-fside" tabIndex={open ? undefined : -1} aria-hidden={open ? undefined : true}
          aria-label={status === 'incoming' ? 'Odmítnout' : 'Zpět'} disabled={busy} onClick={onSide}>
          {status === 'incoming' ? 'Odmítnout' : X}
        </button>
      </div>
    </div>
  );
}
