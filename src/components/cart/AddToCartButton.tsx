'use client';

import { useState } from 'react';
import { Button } from '@/components/trezor';
import { useCart, type CartItem } from './CartProvider';

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
  const { items, add } = useCart();
  const [added, setAdded] = useState(false);
  const inCart = items.find((i) => i.listingId === item.listingId);
  const full = inCart ? inCart.quantity >= item.maxQuantity : false;

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={full}
      onClick={() => {
        add(item);
        setAdded(true);
        setTimeout(() => setAdded(false), 1500);
      }}
    >
      {full ? 'V košíku' : added ? 'Přidáno' : label}
    </Button>
  );
}
