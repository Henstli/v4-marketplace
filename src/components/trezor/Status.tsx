import type { ReactNode } from 'react';
import { cx } from './cx';

export interface StatusProps {
  /** ok = v pořádku (spárováno), warn = potřebuje opravu, muted = vynecháno */
  tone?: 'ok' | 'warn' | 'muted';
  children: ReactNode;
  className?: string;
}

/** Krátký štítek stavu s tečkou, vždy s textem. */
export function Status({ tone = 'muted', children, className }: StatusProps) {
  return <span className={cx('tz-status', `tz-status-${tone}`, className)}>{children}</span>;
}
