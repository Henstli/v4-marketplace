'use client';

import { useEffect } from 'react';
import { Button, ButtonLink } from '@/components/trezor';

/** Když stránka spadne (třeba databáze chvíli neodpovídá), ukáže srozumitelnou zprávu místo obecné chyby. */
export default function PageError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="container section">
      <div className="panel" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h1 className="t-heading-l">Stránku se teď nepodařilo načíst</h1>
        <p className="muted">Server odpovídá pomaleji než obvykle. Zkuste to prosím za chvíli znovu.</p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Button onClick={reset}>Zkusit znovu</Button>
          <ButtonLink href="/" variant="ghost">Na úvodní stránku</ButtonLink>
        </div>
      </div>
    </div>
  );
}
