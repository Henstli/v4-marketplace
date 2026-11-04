import Link from 'next/link';

export interface PageTab {
  label: string;
  /** Bez odkazu = připravujeme (štítek Brzy) */
  href?: string;
  /** Číslo za názvem (šedě) */
  n?: number;
  /** Počet nových (mátový kroužek) */
  count?: number;
}

/** Záložky stránky (DS Trezor › AccountMenu › Záložky stránky): Sklad/Sbírka, Podpora. */
export function PageTabs({ tabs, current, label }: { tabs: PageTab[]; current: string; label: string }) {
  return (
    <nav className="tz-pagetabs" aria-label={label}>
      {tabs.map((t) => {
        const end = t.count ? <span className="tz-acct-count">{t.count}</span>
          : t.n ? <span className="tz-pagetabs-n">{t.n.toLocaleString('cs-CZ')}</span> : null;
        return t.href ? (
          <Link key={t.label} href={t.href} aria-current={t.href === current ? 'page' : undefined}>{t.label}{end}</Link>
        ) : (
          <span key={t.label} aria-disabled="true">{t.label}<span className="tz-acct-soon">Brzy</span></span>
        );
      })}
    </nav>
  );
}

export type StockTab = 'vse' | 'prodej' | 'odeslat' | 'hledam' | 'sady' | 'historie' | 'pridat' | 'import';

/** Záložky Skladu (obchod) nebo Sbírky (sběratel). Sběratel má navíc Hledám a Chybí do sad. */
export function StockTabs({ current, shop, onSale, toShip }: { current: StockTab; shop: boolean; onSale?: number; toShip?: number }) {
  const href: Record<StockTab, string> = {
    vse: '/prodat', prodej: '/prodat?zalozka=prodej', odeslat: '/prodat?zalozka=odeslat', hledam: '/prodat?zalozka=hledam', sady: '/prodat?zalozka=sady',
    historie: '/prodat?zalozka=historie', pridat: '/prodat?zalozka=pridat', import: '/prodat/import',
  };
  const tabs: (PageTab & { key: StockTab })[] = [
    { key: 'vse', label: 'Všechny karty', href: href.vse },
    { key: 'prodej', label: 'Na prodej', href: href.prodej, n: onSale },
    ...(shop ? [{ key: 'odeslat' as const, label: 'K odeslání', href: href.odeslat, count: toShip }] : [
      { key: 'hledam' as const, label: 'Hledám', href: href.hledam },
      { key: 'sady' as const, label: 'Chybí do sad', href: href.sady },
    ]),
    { key: 'historie', label: 'Historie', href: href.historie },
    { key: 'pridat', label: 'Přidat kartu', href: href.pridat },
    { key: 'import', label: 'Nahrát tabulku', href: href.import },
  ];
  return <PageTabs label={shop ? 'Sklad' : 'Sbírka'} current={href[current]} tabs={tabs} />;
}

/** Záložky Podpory: dotaz na podporu a vlastní hlášení. */
export function SupportTabs({ current, reports }: { current: '/podpora' | '/ucet/hlaseni'; reports?: number }) {
  return (
    <PageTabs
      label="Podpora"
      current={current}
      tabs={[
        { label: 'Napsat podpoře', href: '/podpora' },
        { label: 'Moje hlášení', href: '/ucet/hlaseni', count: reports },
      ]}
    />
  );
}
