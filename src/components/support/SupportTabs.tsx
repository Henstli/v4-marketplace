'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/trezor/cx';

const TABS = [
  { href: '/sprava/podpora', label: 'Fronta' },
  { href: '/sprava/podpora/uzivatele', label: 'Uživatelé' },
  { href: '/sprava/podpora/vykaz', label: 'Výkaz času' },
  { href: '/sprava/podpora/zaznam', label: 'Záznam akcí' },
];

/** Záložky panelu podpory (DS Support, rám panelu). */
export function SupportTabs({ className }: { className?: string }) {
  const path = usePathname();
  const active = (href: string) => (href === '/sprava/podpora'
    ? path === href || /^\/sprava\/podpora\/(\d+|novy)/.test(path)
    : path.startsWith(href));
  return (
    <nav aria-label="Podpora" className={className}>
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={cx('tz-chip', active(t.href) && 'tz-chip-selected')} aria-current={active(t.href) ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
