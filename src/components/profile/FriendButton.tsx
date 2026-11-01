'use client';

// Tlačítko přátelství na profilu (DS Trezor › ProfileMat, akce pod kartou):
// Přidat přítele → Žádost odeslána (klik zruší), Přijmout žádost, Přátelé (klik nabídne odebrání).
import { useState, useTransition } from 'react';
import { friendAction, type FriendStatus } from '@/app/ucet/pratele-actions';

const PLUS = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="10" cy="8" r="4" /><path d="M3 21c0-4 3.5-6 7-6M18 13v8M14 17h8" /></svg>;
const CHECK = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

export function FriendButton({ other, initial, signedIn = true, small = false }: { other: string; initial: FriendStatus; signedIn?: boolean; small?: boolean }) {
  const size = small ? 'tz-btn-sm' : 'tz-btn-md';
  const [status, setStatus] = useState(initial);
  const [ask, setAsk] = useState(false);
  const [busy, start] = useTransition();
  const run = (op: Parameters<typeof friendAction>[1]) => start(async () => {
    const r = await friendAction(other, op);
    if (typeof r === 'string') setStatus(r);
    setAsk(false);
  });

  if (!signedIn) return <a href="/prihlaseni" className={`tz-btn ${size} tz-mat-ghost tz-mat-friend`}>{PLUS}Přidat přítele</a>;
  if (ask) {
    return (
      <span className="tz-mat-fask">
        <button type="button" className={`tz-btn ${size} tz-mat-ghost`} disabled={busy} onClick={() => run('remove')}>{status === 'friends' ? 'Odebrat z přátel' : 'Zrušit žádost'}</button>
        <button type="button" className={`tz-btn ${size} tz-mat-ghost`} onClick={() => setAsk(false)}>Ne</button>
      </span>
    );
  }
  if (status === 'incoming') {
    return (
      <span className="tz-mat-fask">
        <button type="button" className={`tz-btn ${size} tz-btn-primary`} disabled={busy} onClick={() => run('accept')}>{CHECK}Přijmout</button>
        <button type="button" className={`tz-btn ${size} tz-mat-ghost`} disabled={busy} onClick={() => run('decline')}>Odmítnout</button>
      </span>
    );
  }
  if (status === 'friends') return <button type="button" className={`tz-btn ${size} tz-mat-ghost tz-mat-friend`} data-on="" onClick={() => setAsk(true)}>{CHECK}Přátelé</button>;
  if (status === 'outgoing') return <button type="button" className={`tz-btn ${size} tz-mat-ghost tz-mat-friend`} data-wait="" title="Kliknutím žádost zrušíte" onClick={() => setAsk(true)}>Žádost odeslána</button>;
  return <button type="button" className={`tz-btn ${size} tz-mat-ghost tz-mat-friend`} disabled={busy} onClick={() => run('request')}>{PLUS}Přidat přítele</button>;
}
