import { formatPrice } from '@/lib/format';
import { cx } from './cx';

export interface PriceProps {
  amount: number;
  /** Text před cenou, např. "od" */
  prefix?: string;
  currency?: string;
  size?: 'md' | 'lg';
}

export function Price({ amount, prefix, currency = 'Kč', size = 'md' }: PriceProps) {
  return (
    <span className={cx('tz-price', `tz-price-${size}`)}>
      {(prefix ? prefix + ' ' : '') + formatPrice(amount, currency)}
    </span>
  );
}
