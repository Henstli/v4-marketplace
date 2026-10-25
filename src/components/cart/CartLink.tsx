'use client';

import { ButtonLink } from '@/components/trezor';
import { useCart } from './CartProvider';

export function CartLink() {
  const { count } = useCart();
  return (
    <ButtonLink href="/kosik" variant="secondary" aria-label={count ? `Košík, ${count} položek` : 'Košík'}>
      Košík{count ? <span className="t-price">{count}</span> : null}
    </ButtonLink>
  );
}
