'use client';

import { useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/format';

// Posledních 6 hodin je odpočet červený a běží po sekundách (DS Status, varianta B).
const URGENT_MS = 6 * 3600_000;

/** Aktuální čas, obnovovaný každou sekundu v posledních 6 hodinách, jinak každých 30 s. */
function useLeft(expiresAt: string): number {
  const end = Date.parse(expiresAt);
  const [now, setNow] = useState(() => Date.now());
  const left = end - now;
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), left < URGENT_MS ? 1000 : 30_000);
    return () => clearTimeout(t);
  }, [left]);
  return left;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** „1 d 5 h“, „14 h 20 min“, nebo v posledních 6 hodinách „5:18:42“. */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (ms < URGENT_MS) return `${h}:${pad(m)}:${pad(s % 60)}`;
  return d ? `${d} d ${h} h` : `${h} h ${m} min`;
}

/** Štítek „Čeká na potvrzení“ s hodinami a zbývajícím časem. */
export function ExpiryStatus({ expiresAt, role, label = 'Čeká na potvrzení', className }: { expiresAt: string; role: 'buyer' | 'seller'; label?: string; className?: string }) {
  const left = useLeft(expiresAt);
  const urgent = left < URGENT_MS;
  const tone = left <= 0 ? 'muted' : urgent ? 'danger' : 'warn';
  const text = left <= 0
    ? 'Vypršelo'
    : urgent
      ? `${role === 'seller' ? 'Potvrďte do' : 'Vyprší za'} ${formatLeft(left)}`
      : `${label} · zbývá ${formatLeft(left)}`;
  return (
    <span
      className={`tz-status tz-status-${tone} tz-status-clock${className ? ` ${className}` : ''}`}
      title={`Vyprší ${formatDateTime(expiresAt)}`}
      suppressHydrationWarning
    >
      {text}
    </span>
  );
}

/** Pole v Co dál: kdy objednávka vyprší, kolik zbývá a ubývající pruh od objednání. */
export function ExpiryMeter({ createdAt, expiresAt }: { createdAt: string; expiresAt: string }) {
  const left = useLeft(expiresAt);
  const total = Date.parse(expiresAt) - Date.parse(createdAt);
  const share = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0;
  const tone = left <= 0 ? 'muted' : left < URGENT_MS ? 'danger' : 'warn';
  return (
    <div className="tz-expiry" data-tone={tone}>
      <div className="tz-expiry-row">
        <span className="t-small muted">Vyprší {formatDateTime(expiresAt)}</span>
        <strong className="code" suppressHydrationWarning>{left <= 0 ? 'Vypršelo' : formatLeft(left)}</strong>
      </div>
      <span className="tz-expiry-bar" style={{ ['--left' as string]: `${(share * 100).toFixed(2)}%` }} suppressHydrationWarning />
    </div>
  );
}
