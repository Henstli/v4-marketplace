'use client';

import { useState } from 'react';
import { Button } from '@/components/trezor';
import { useCart, type CartItem } from './CartProvider';

/** Do košíku; když už kus v košíku je, ukáže počet s tlačítky − a +. */
export function AddToCartButton({
  item,
  label = 'Do košíku',
  variant = 'secondary',
  size = 'md',
  className,
}: {
  item: Omit<CartItem, 'quantity'>;
  label?: string;
  variant?: 'primary' | 'secondary';
  size?: 'md' | 'lg';
  className?: string;
}) {
  const { items, add, setQuantity, remove } = useCart();
  const [added, setAdded] = useState(false);
  const inCart = items.find((i) => i.listingId === item.listingId);

  if (inCart) {
    const full = inCart.quantity >= item.maxQuantity;
    return (
      <div className={['tz-qty', `tz-qty-${size}`, className].filter(Boolean).join(' ')} role="group" aria-label="Počet v košíku">
        <button type="button" aria-label={inCart.quantity > 1 ? 'Odebrat kus' : 'Odebrat z košíku'} onClick={() => (inCart.quantity > 1 ? setQuantity(item.listingId, inCart.quantity - 1) : remove(item.listingId))}>−</button>
        <span aria-live="polite"><b>{inCart.quantity}</b> <span className="tz-qty-label">{added ? 'přidáno' : 'v košíku'}</span></span>
        <button type="button" aria-label="Přidat kus" disabled={full} title={full ? 'Víc kusů prodejce nemá' : undefined} onClick={() => add(item)}>+</button>
      </div>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => {
        add(item);
        setAdded(true);
        setTimeout(() => setAdded(false), 1500);
      }}
    >
      {label}
    </Button>
  );
}
