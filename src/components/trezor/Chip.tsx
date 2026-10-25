import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { cx } from './cx';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** Barva tečky kategorie, např. "var(--game-pokemon)" */
  dot?: string;
}

export function Chip({ selected, dot, children, className, type = 'button', ...rest }: ChipProps) {
  return (
    <button type={type} {...rest} className={cx('tz-chip', className)} aria-pressed={selected ? 'true' : 'false'}>
      {dot ? <span className="tz-chip-dot" style={{ background: dot }} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Čip jako odkaz, pro filtry v URL. */
export function ChipLink({ href, selected, dot, children }: { href: string; selected?: boolean; dot?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx('tz-chip', selected && 'tz-chip-selected')} aria-current={selected ? 'true' : undefined}>
      {dot ? <span className="tz-chip-dot" style={{ background: dot }} aria-hidden="true" /> : null}
      {children}
    </Link>
  );
}
