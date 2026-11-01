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

/** Záložky Skladu (obchod) nebo Sbírky (sběratel). */
export function StockTabs({ current, listings }: { current: '/prodat' | '/prodat/import'; listings: number }) {
  return (
    <PageTabs
      label="Sklad"
      current={current}
      tabs={[
        { label: 'Všechny karty' },
        { label: 'Na prodej', href: '/prodat', n: listings },
        { label: 'Hromadné nahrávání', href: '/prodat/import' },
      ]}
    />
  );
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
