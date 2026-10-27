import Link from 'next/link';

const ICONS = {
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  bag: <><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
};

/** Ikona v hlavičce (Zprávy, Košík) s odznakem počtu, podle DS Messages (varianta B). */
export function HeaderIcon({ href, icon, label, count, countLabel, current }: {
  href: string;
  icon: keyof typeof ICONS;
  label: string;
  count: number;
  /** Text pro čtečky, např. „2 nepřečtené“ */
  countLabel?: string;
  current?: boolean;
}) {
  return (
    <Link
      href={href}
      // Bez předběžného načtení: seznam zpráv i košík musí být při kliknutí čerstvé, ne z mezipaměti.
      prefetch={false}
      className="tz-hdr-ico"
      title={label}
      aria-label={count ? `${label}, ${countLabel ?? count}` : label}
      aria-current={current ? 'page' : undefined}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[icon]}
      </svg>
      {count ? <span className="tz-hdr-badge" aria-hidden="true">{count > 9 ? '9+' : count}</span> : null}
    </Link>
  );
}
