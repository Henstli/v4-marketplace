import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { formatNumber } from '@/lib/format';

export interface BulkBarProps {
  /** Počet vybraných řádků */
  count: number;
  /** Akce; třída tz-bulkbar-group drží pole a tlačítko u sebe */
  children?: ReactNode;
  /** Zobrazí tlačítko „Zrušit výběr“ */
  onClear?: () => void;
  label?: string;
  className?: string;
}

// Lišta hromadných akcí přilepená u spodního okraje okna. Ukazuje se, jen když je něco vybráno.
export function BulkBar({ count, children, onClear, label = 'Hromadné úpravy', className }: BulkBarProps) {
  const word = count === 1 ? 'vybraná' : count >= 2 && count <= 4 ? 'vybrané' : 'vybraných';
  return (
    <div className={cx('tz-bulkbar', className)} role="region" aria-label={label}>
      <span className="tz-bulkbar-count" aria-live="polite">{formatNumber(count)} {word}</span>
      {children}
      {onClear ? <Button variant="ghost" onClick={onClear}>Zrušit výběr</Button> : null}
    </div>
  );
}
