'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/sprava/podpora', label: 'Fronta', match: /^\/sprava\/podpora(\/\d+.*|\/novy|\/hlaseni.*)?$/ },
  { href: '/sprava/podpora/uzivatele', label: 'Uživatelé', match: /^\/sprava\/podpora\/uzivatele/ },
  { href: '/sprava/podpora/vykaz', label: 'Výkaz času', match: /^\/sprava\/podpora\/vykaz/ },
  { href: '/sprava/podpora/tym', label: 'Tým', match: /^\/sprava\/podpora\/(tym|zaznam)/ },
  { href: '/sprava/podpora/chat', label: 'Chat týmu', match: /^\/sprava\/podpora\/chat/ },
];

/** Položky levého panelu režimu podpory (DS Support, Režim podpory). */
export function SupportNav({ late, unread, className, itemClass, countClass, unreadClass }: {
  late: number; unread: number; className: string; itemClass: string; countClass: string; unreadClass: string;
}) {
  const path = usePathname();
  return (
    <nav aria-label="Podpora" className={className}>
      {ITEMS.map((i) => (
        <Link key={i.label} href={i.href} className={itemClass} aria-current={i.match.test(path) ? 'page' : undefined}>
          <span>{i.label}</span>
          {i.href === '/sprava/podpora' && late ? <span className={countClass} title="Po termínu">{late}</span> : null}
          {i.href === '/sprava/podpora/chat' && unread ? <span className={unreadClass} title="Nepřečtené">{unread}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
