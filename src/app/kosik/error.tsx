'use client';

import { useEffect } from 'react';
import { Button } from '@/components/trezor';

// Klíč košíku v prohlížeči (CartProvider).
const STORAGE_KEY = 'v4market.cart';

/** Když se košík nepodaří vykreslit, nabídne znovu načíst nebo ho vyprázdnit (košík je jen v prohlížeči). */
export default function CartError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const clear = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    window.location.reload();
  };
  return (
    <div className="container section">
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
        <h1 className="t-heading-l">Košík se nepodařilo načíst</h1>
        <p className="muted">Zkuste ho načíst znovu. Když to nepomůže, vyprázdněte ho a karty přidejte znovu.</p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Button onClick={reset}>Zkusit znovu</Button>
          <Button variant="ghost" onClick={clear}>Vyprázdnit košík</Button>
        </div>
      </div>
    </div>
  );
}
