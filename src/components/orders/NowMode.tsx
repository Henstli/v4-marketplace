'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/trezor';
import { setOrderStatus } from '@/app/objednavky/actions';

// Rámeček „Co teď“ (DS Orders): tlačítko jako Odmítnout nebo Protinávrh vymění řadu tlačítek
// za pole a potvrzení (tz-ord-swap), Upravit dopravu otevře formulář pod čarou.
const Ctx = createContext<{ mode: string; setMode: (m: string) => void }>({ mode: '', setMode: () => {} });

export function NowModes({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState('');
  return <Ctx.Provider value={{ mode, setMode }}>{children}</Ctx.Provider>;
}

export function useNowMode() {
  return useContext(Ctx);
}

/** Obsah viditelný jen v daném režimu ('' = výchozí řada tlačítek). */
export function ModeArea({ when, children, className }: { when: string; children: ReactNode; className?: string }) {
  const { mode } = useContext(Ctx);
  if (mode !== when) return null;
  return className ? <div className={className}>{children}</div> : <>{children}</>;
}

export function ModeButton({ to, variant, children, className, label }: { to: string; variant?: 'primary' | 'secondary' | 'ghost'; children: ReactNode; className?: string; label?: string }) {
  const { setMode } = useContext(Ctx);
  return <Button variant={variant === 'primary' ? undefined : variant} className={className} aria-label={label} onClick={() => setMode(to)}>{children}</Button>;
}

const X = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);

/** ✕ zpět na výchozí řadu tlačítek. */
export function ModeBack() {
  return <ModeButton to="" variant="ghost" className="tz-ord-x" label="Zpět">{X}</ModeButton>;
}

function Submit({ children, variant }: { children: ReactNode; variant?: 'secondary' }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} disabled={pending}>{pending ? 'Ukládám…' : children}</Button>;
}

/** Odmítnutí s nepovinným důvodem pro kupujícího (DS Orders › Odmítnout). */
export function DeclineSwap({ id }: { id: string }) {
  return (
    <ModeArea when="decline">
      <form action={setOrderStatus} className="tz-ord-swap">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="op" value="decline" />
        <ModeBack />
        <input name="reason" maxLength={200} placeholder="Důvod pro kupujícího (nepovinné)" aria-label="Důvod odmítnutí pro kupujícího" autoFocus />
        <Submit variant="secondary">Odmítnout objednávku</Submit>
      </form>
    </ModeArea>
  );
}
