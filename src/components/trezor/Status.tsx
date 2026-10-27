import type { ReactNode } from 'react';
import { cx } from './cx';

export type StatusTone = 'ok' | 'warn' | 'muted' | 'danger' | 'info';

export interface StatusProps {
  /** ok = v pořádku (spárováno), warn = potřebuje opravu, muted = vynecháno, danger = objednávka zrušená nebo odmítnutá, info = probíhá */
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}

/** Krátký štítek stavu s tečkou, vždy s textem. */
export function Status({ tone = 'muted', children, className }: StatusProps) {
  return <span className={cx('tz-status', `tz-status-${tone}`, className)}>{children}</span>;
}
