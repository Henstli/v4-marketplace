'use client';

// Tlačítko přátelství na profilu (DS Trezor › ProfileMat, akce pod kartou), vždy jedno celé tlačítko:
// Přidat přítele (klik pošle žádost); Žádost odeslána, Odpovědět na žádost a Přátelé otevřou malou nabídku
// (Zrušit žádost / Přijmout a Odmítnout / Odebrat z přátel).
import { useEffect, useRef, useState, useTransition } from 'react';
import { friendAction, type FriendStatus } from '@/app/ucet/pratele-actions';

const PLUS = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="10" cy="8" r="4" /><path d="M3 21c0-4 3.5-6 7-6M18 13v8M14 17h8" /></svg>;
const CHECK = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const X = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const DOWN = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="tz-mat-fdown"><path d="M6 9l6 6 6-6" /></svg>;

type Op = Parameters<typeof friendAction>[1];

export function FriendButton({ other, initial, signedIn = true, defaultOpen = false }: { other: string; initial: FriendStatus; signedIn?: boolean; defaultOpen?: boolean }) {
  const [status, setStatus] = useState(initial);
  const [open, setOpen] = useState(defaultOpen);
  const [busy, start] = useTransition();
  const wrap = useRef<HTMLSpanElement>(null);
  const run = (op: Op) => start(async () => {
    const r = await friendAction(other, op);
    if (typeof r === 'string') setStatus(r);
    setOpen(false);
  });
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  const cls = 'tz-btn tz-btn-md tz-mat-ghost tz-mat-friend';
  if (!signedIn) return <a href="/prihlaseni" className={cls}>{PLUS}Přidat přítele</a>;
  if (status === 'none') return <button type="button" className={cls} disabled={busy} onClick={() => run('request')}>{PLUS}Přidat přítele</button>;

  const label = status === 'friends' ? <>{CHECK}Přátelé</> : status === 'incoming' ? <>{PLUS}Nová žádost</> : <>Žádost odeslána</>;
  const items: { op: Op; text: string; icon: React.ReactNode; tone?: 'up' | 'down' }[] =
    status === 'friends' ? [{ op: 'remove', text: 'Odebrat z přátel', icon: X, tone: 'down' }]
    : status === 'incoming' ? [{ op: 'accept', text: 'Přijmout žádost', icon: CHECK, tone: 'up' }, { op: 'decline', text: 'Odmítnout', icon: X }]
    : [{ op: 'remove', text: 'Zrušit žádost', icon: X }];
  return (
    <span className="tz-mat-fwrap" ref={wrap}>
      <button type="button" className={cls} data-s={status} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}{DOWN}
      </button>
      {open ? (
        <span className="tz-mat-fmenu" role="menu">
          {status === 'incoming' ? <span className="tz-mat-fmhead">Chce se s tebou přátelit</span> : null}
          {items.map((x) => (
            <button key={x.text} type="button" role="menuitem" className="tz-mat-fitem" data-tone={x.tone} disabled={busy} onClick={() => run(x.op)}>{x.icon}{x.text}</button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
