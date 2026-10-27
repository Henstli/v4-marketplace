'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import { watchCard } from '@/app/hlidani/actions';

/**
 * Čekací pořadník: „Dát vědět, až se objeví nabídka“. Varianta compact je tlačítko „Čekat“
 * u rezervované nabídky v tabulce.
 */
export function WatchButton({ cardId, size = 'lg', compact }: { cardId: string; size?: 'md' | 'lg'; compact?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  const [pending, start] = useTransition();

  const click = () =>
    start(async () => {
      const r = await watchCard(cardId);
      if ('ok' in r) return setState('done');
      if (r.error === 'login') return router.push(`/prihlaseni?dalsi=${encodeURIComponent(path)}`);
      setState('error');
    });

  if (state === 'done') {
    return <p className="t-small" role="status">{compact ? 'Hlídáte' : 'Hlídáte. Jakmile se objeví nabídka, pošleme vám e-mail.'}</p>;
  }
  return (
    <>
      <Button variant="secondary" size={size} onClick={click} disabled={pending}>
        {pending ? 'Ukládám…' : compact ? 'Čekat' : 'Dát vědět, až se objeví nabídka'}
      </Button>
      {state === 'error' ? <p className="t-small" role="alert">Nepodařilo se uložit, zkuste to znovu.</p> : null}
    </>
  );
}
