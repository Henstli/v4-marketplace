'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ShopLogo, SellerBadge, shopStyle } from '@/components/trezor';
import { signOut } from '@/app/prihlaseni/actions';
import type { AccountSummary } from '@/lib/account';
import { PLANS } from '@/lib/plans';

const ICONS = {
  home: <path d="M4 11l8-7 8 7v9H4z" />,
  shop: <path d="M4 9h16l-1-5H5zM5 9v11h14V9M9 20v-6h6v6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  coll: <><rect x="4" y="5" width="11" height="15" rx="2" /><path d="M8 3h10a2 2 0 0 1 2 2v13" /></>,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />,
  wish: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  offers: <path d="M4 7h16M4 12h16M4 17h10" />,
  orders: <path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" />,
  bulk: <path d="M12 4v11M7 9l5-5 5 5M5 20h14" />,
  card: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M12 8v6M9 11h6" /></>,
  plan: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  admin: <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z" />,
  out: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  down: <path d="M6 9l6 6 6-6" />,
};
export type IconName = keyof typeof ICONS;

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

interface NavItem {
  label: string;
  icon: IconName;
  /** Bez odkazu = připravujeme */
  href?: string;
  count?: number;
  hint?: string;
  /** Jen v boční navigaci (v menu je to tlačítko nahoře) */
  sideOnly?: boolean;
}

function navGroups(a: AccountSummary): { title?: string; items: NavItem[] }[] {
  const pending = a.toShip + a.toConfirm;
  return [
    {
      title: 'Moje',
      items: [
        { label: 'Přehled', icon: 'home', href: '/ucet', sideOnly: true },
        { label: a.shopPage ? (a.kind === 'shop' ? 'Můj obchod' : 'Moje stránka') : 'Můj profil', icon: 'shop', href: a.href },
        ...(a.shopPage ? [{ label: 'Upravit stránku', icon: 'edit' as const, href: '/ucet/stranka', sideOnly: true }] : []),
        { label: 'Sbírka', icon: 'coll' },
        { label: 'Wishlist', icon: 'wish' },
      ],
    },
    {
      title: 'Obchodování',
      items: [
        { label: 'Moje nabídky', icon: 'offers', href: '/prodat', hint: a.listings ? a.listings.toLocaleString('cs-CZ') : undefined },
        { label: 'Objednávky', icon: 'orders', href: '/objednavky', count: pending || undefined },
        { label: 'Hlídané karty', icon: 'bell', href: '/ucet/hlidane', count: a.alerts || undefined },
        { label: 'Hlášení', icon: 'flag', href: '/ucet/hlaseni', count: a.reports || undefined },
        ...(PLANS[a.plan].bulkImport ? [{ label: 'Hromadné nahrávání', icon: 'bulk' as const, href: '/prodat/import' }] : []),
        { label: 'Návrhy karet', icon: 'card', href: '/prodat/nova-karta' },
      ],
    },
    {
      title: 'Účet',
      items: [
        { label: 'Předplatné', icon: 'plan', href: '/ucet/predplatne', hint: PLANS[a.plan].name },
        { label: 'Nastavení účtu', icon: 'gear', href: '/ucet/nastaveni' },
      ],
    },
    ...(a.isAdmin
      ? [{
          title: 'Správa',
          items: [
            { label: 'Schvalování karet', icon: 'admin' as const, href: '/sprava/karty' },
            { label: 'Předplatné prodejců', icon: 'admin' as const, href: '/sprava/predplatne' },
            { label: 'Podpora', icon: 'flag' as const, href: '/sprava/podpora' },
          ],
        }]
      : []),
  ];
}

function isActive(pathname: string, href: string) {
  if (href === '/ucet' || href === '/prodat') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Item({ item, pathname, onClick }: { item: NavItem; pathname: string; onClick?: () => void }) {
  const end = item.count ? <span className="tz-acct-count">{item.count}</span>
    : !item.href ? <span className="tz-acct-soon">Brzy</span>
    : item.hint ? <span className="tz-acct-hint">{item.hint}</span> : null;
  if (!item.href) {
    return <span className="tz-acct-item" aria-disabled="true"><Icon name={item.icon} />{item.label}{end}</span>;
  }
  return (
    <Link href={item.href} className="tz-acct-item" aria-current={isActive(pathname, item.href) ? 'page' : undefined} onClick={onClick}>
      <Icon name={item.icon} />{item.label}{end}
    </Link>
  );
}

function Avatar({ a, size }: { a: AccountSummary; size: number }) {
  return <span style={shopStyle(a.color)}><ShopLogo name={a.name} image={a.logo} size={size} /></span>;
}

export function AccountWho({ a }: { a: AccountSummary }) {
  return (
    <div className="tz-acct-who">
      <Avatar a={a} size={44} />
      <div>
        <div className="tz-acct-name"><span>{a.name}</span>{a.plan === 'pro' ? <SellerBadge type="pro" /> : null}</div>
        <p className="tz-acct-sub">{a.kind === 'shop' ? 'Obchod' : 'Sběratel'} · {a.email}</p>
      </div>
    </div>
  );
}

/** Tlačítko Můj profil v hlavičce s rozbalovacím menu (na telefonu panel zespodu). */
export function AccountMenu({ a }: { a: AccountSummary }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const pending = a.toShip + a.toConfirm + a.alerts + a.reports;

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const items = () => [...(wrap.current?.querySelectorAll<HTMLElement>('.tz-acct-menu a, .tz-acct-menu button') ?? [])];
    items()[0]?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); button.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLElement);
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div className="tz-acct-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="tz-acct-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={pending ? 'Můj profil, máte novinky' : 'Můj profil'}
        onClick={() => setOpen(!open)}
      >
        <Avatar a={a} size={32} />
        <span className="tz-acct-label">Můj profil</span>
        <Icon name="down" size={16} />
        {pending ? <span className="tz-acct-dot" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <>
          <div className="tz-acct-scrim" onClick={close} aria-hidden="true" />
          <div className="tz-acct-menu" role="menu" aria-label="Můj profil">
            <AccountWho a={a} />
            <div className="tz-acct-cta">
              <Link href={a.href} className="tz-btn tz-btn-primary" onClick={close}>{a.shopPage ? (a.kind === 'shop' ? 'Zobrazit obchod' : 'Zobrazit stránku') : 'Zobrazit profil'}</Link>
              <Link href={a.shopPage ? '/ucet/stranka' : '/ucet'} className="tz-btn tz-btn-secondary" onClick={close}>{a.shopPage ? 'Upravit stránku' : 'Přehled účtu'}</Link>
            </div>
            {navGroups(a).map((g, i) => (
              <div key={g.title ?? i}>
                <div className="tz-acct-sep" />
                {g.title ? <p className="tz-acct-gh">{g.title}</p> : null}
                {g.items.filter((x) => !x.sideOnly).map((x) => <Item key={x.label} item={x} pathname={pathname} onClick={close} />)}
              </div>
            ))}
            <div className="tz-acct-sep" />
            <form action={signOut}>
              <button type="submit" className="tz-acct-item tz-acct-out"><Icon name="out" />Odhlásit</button>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Boční navigace centra účtu; na úzké obrazovce posuvné záložky. */
export function AccountSide({ a, children }: { a: AccountSummary; children: ReactNode }) {
  const pathname = usePathname();
  const groups = navGroups(a);
  const linked = groups.flatMap((g) => g.items).filter((x) => x.href);
  return (
    <div className="container tz-acct">
      <nav className="tz-acct-side" aria-label="Můj profil">
        <AccountWho a={a} />
        {groups.map((g) => (
          <div key={g.title}>
            <p className="tz-acct-gh">{g.title}</p>
            {g.items.map((x) => <Item key={x.label} item={x} pathname={pathname} />)}
          </div>
        ))}
      </nav>
      <div className="tz-acct-main">
        <nav className="tz-acct-tabs" aria-label="Můj profil">
          {linked.map((x) => (
            <Link key={x.label} href={x.href!} aria-current={isActive(pathname, x.href!) ? 'page' : undefined}>
              {x.label}{x.count ? <span className="tz-acct-count">{x.count}</span> : null}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
