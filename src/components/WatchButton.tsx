'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import { isWatching, stopWatching, watchCard } from '@/app/hlidani/actions';

// Hlídání platí pro kartu: všechna tlačítka téže karty na stránce sdílejí jeden dotaz a stav.
const known = new Map<string, Promise<boolean>>();
const EVENT = 'v4-watch';

const Check = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/**
 * Čekací pořadník: „Dát vědět, až se objeví nabídka“. Varianta compact je tlačítko „Čekat“
 * u rezervované nabídky v tabulce. Zapnuté hlídání je tlačítko „Hlídáte“ se zatržítkem
 * (DS OfferTable), dalším kliknutím se zruší. Stav se načte i po obnovení stránky.
 */
export function WatchButton({ cardId, size = 'lg', compact }: { cardId: string; size?: 'md' | 'lg'; compact?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [on, setOn] = useState(false);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    if (!known.has(cardId)) known.set(cardId, isWatching(cardId).catch(() => false));
    known.get(cardId)!.then((v) => { if (alive) setOn(v); });
    const sync = (e: Event) => {
      const d = (e as CustomEvent<{ cardId: string; on: boolean }>).detail;
      if (d.cardId === cardId) setOn(d.on);
    };
    window.addEventListener(EVENT, sync);
    return () => { alive = false; window.removeEventListener(EVENT, sync); };
  }, [cardId]);

  const click = () =>
    start(async () => {
      setError(false);
      const r = on ? await stopWatching(cardId) : await watchCard(cardId);
      if ('error' in r) {
        if (r.error === 'login') return router.push(`/prihlaseni?dalsi=${encodeURIComponent(path)}`);
        return setError(true);
      }
      known.set(cardId, Promise.resolve(!on));
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { cardId, on: !on } }));
    });

  const label = on
    ? compact ? 'Hlídáte' : 'Hlídáte · pošleme e-mail, až se objeví nabídka'
    : compact ? 'Čekat' : 'Dát vědět, až se objeví nabídka';
  return (
    <>
      <Button
        variant="secondary"
        size={size}
        onClick={click}
        disabled={pending}
        aria-pressed={on}
        title={on ? 'Přestat hlídat' : undefined}
        className={on ? 'tz-btn-on' : undefined}
      >
        {on ? <Check /> : null}
        {pending ? 'Ukládám…' : label}
      </Button>
      {error ? <p className="t-small" role="alert">Nepodařilo se uložit, zkuste to znovu.</p> : null}
    </>
  );
}
