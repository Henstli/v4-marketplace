'use client';

import { formatDateTime } from '@/lib/format';
import { formatLeft, useLeft } from './Expiry';

/**
 * Prodejce po Nepřišla a Platba odešla nemůže hned zrušit (DS Reports › Platba odešla):
 * kdy Zrušit půjde, kolik zbývá a pruh od poslední reakce kupujícího.
 */
export function CancelLock({ from, until, role = 'seller' }: { from: string; until: string; role?: 'buyer' | 'seller' }) {
  const left = useLeft(until);
  if (left <= 0) return null;
  const total = Date.parse(until) - Date.parse(from);
  const done = total > 0 ? Math.min(1, Math.max(0, 1 - left / total)) : 1;
  return (
    <div className="tz-expiry" data-tone="muted">
      <div className="tz-expiry-row">
        <span className="t-small muted">{role === 'seller' ? 'Zrušit půjde od' : 'Prodejce může zrušit od'} {formatDateTime(until)}</span>
        <strong className="code" suppressHydrationWarning>{formatLeft(left)}</strong>
      </div>
      <span className="tz-expiry-bar" style={{ ['--left' as string]: `${(done * 100).toFixed(2)}%` }} suppressHydrationWarning />
    </div>
  );
}
