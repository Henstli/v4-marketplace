'use client';

import { usePathname } from 'next/navigation';
import { HeaderIcon } from '@/components/site/HeaderIcon';
import { useCart } from './CartProvider';

export function CartLink() {
  const { count } = useCart();
  const pathname = usePathname();
  return <HeaderIcon href="/kosik" icon="bag" label="Košík" count={count} countLabel={`${count} ks`} current={pathname === '/kosik'} />;
}
