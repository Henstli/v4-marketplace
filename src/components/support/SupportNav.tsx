'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/sprava/podpora', label: 'Fronta', match: /^\/sprava\/podpora(\/\d+.*|\/novy|\/hlaseni.*)?$/ },
  { href: '/sprava/podpora/uzivatele', label: 'Uživatelé', match: /^\/sprava\/podpora\/uzivatele/ },
  { href: '/sprava/podpora/vykaz', label: 'Výkaz času', match: /^\/sprava\/podpora\/vykaz/ },
  { href: '/sprava/podpora/tym', label: 'Tým', match: /^\/sprava\/podpora\/(tym|zaznam)/ },
];

/** Položky levého panelu režimu podpory (DS Support, Režim podpory). */
export function SupportNav({ late, className, itemClass, countClass }: { late: number; className: string; itemClass: string; countClass: string }) {
  const path = usePathname();
  return (
    <nav aria-label="Podpora" className={className}>
      {ITEMS.map((i) => (
        <Link key={i.label} href={i.href} className={itemClass} aria-current={i.match.test(path) ? 'page' : undefined}>
          <span>{i.label}</span>
          {i.href === '/sprava/podpora' && late ? <span className={countClass} title="Po termínu">{late}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
