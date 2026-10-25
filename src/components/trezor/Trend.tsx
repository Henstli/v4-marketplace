import { formatNumber } from '@/lib/format';
import { cx } from './cx';

export interface TrendProps {
  /** Změna v procentech, např. 4.2 nebo -2.1 */
  value: number;
  /** Zobrazit jako štítek s podkladem */
  pill?: boolean;
  /** Text za hodnotou, např. "za 30 dní" */
  suffix?: string;
}

export function Trend({ value, pill, suffix }: TrendProps) {
  const up = value >= 0;
  return (
    <span className={cx('tz-trend', up ? 'tz-trend-up' : 'tz-trend-down', pill && 'tz-trend-pill')}>
      {(up ? '▲ ' : '▼ ') + formatNumber(Math.abs(value), 1) + ' %' + (suffix ? ' ' + suffix : '')}
    </span>
  );
}
