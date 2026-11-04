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

export type StockTab = 'vse' | 'prodej' | 'odeslat' | 'hledam' | 'sady' | 'historie' | 'trh' | 'inventura' | 'tym' | 'napojeni' | 'pridat' | 'import';

/**
 * Záložky Skladu (obchod) nebo Sbírky (sběratel). Sběratel má navíc Hledám a Chybí do sad, obchod Inventuru a Zaměstnance.
 * `allowed`: záložky, na které má přihlášený právo (ve skladu cizího obchodu); `q`: 'obchod=…' pro sklad obchodu.
 */
export function StockTabs({ current, shop, onSale, toShip, toReview, allowed, q = '' }: {
  current: StockTab; shop: boolean; onSale?: number; toShip?: number; toReview?: number; allowed?: StockTab[]; q?: string;
}) {
  const at = (zalozka?: string) => {
    const sp = new URLSearchParams();
    if (zalozka) sp.set('zalozka', zalozka);
    if (q) sp.set('obchod', q.slice('obchod='.length));
    const x = sp.toString();
    return x ? `/prodat?${x}` : '/prodat';
  };
  const href: Record<StockTab, string> = {
    vse: at(), prodej: at('prodej'), odeslat: at('odeslat'), hledam: at('hledam'), sady: at('sady'),
    historie: at('historie'), trh: at('trh'), inventura: at('inventura'), tym: at('tym'), napojeni: at('napojeni'), pridat: at('pridat'), import: '/prodat/import',
  };
  const tabs: (PageTab & { key: StockTab })[] = [
    { key: 'vse', label: 'Všechny karty', href: href.vse },
    { key: 'prodej', label: 'Na prodej', href: href.prodej, n: onSale },
    ...(shop ? [{ key: 'odeslat' as const, label: 'K odeslání', href: href.odeslat, count: toShip }] : [
      { key: 'hledam' as const, label: 'Hledám', href: href.hledam },
      { key: 'sady' as const, label: 'Chybí do sad', href: href.sady },
    ]),
    { key: 'historie', label: 'Historie', href: href.historie },
    ...(shop ? [
      { key: 'trh' as const, label: 'Trh', href: href.trh },
      { key: 'inventura' as const, label: 'Inventura', href: href.inventura, count: toReview },
      { key: 'tym' as const, label: 'Zaměstnanci a role', href: href.tym },
      { key: 'napojeni' as const, label: 'Napojení', href: href.napojeni },
    ] : []),
    { key: 'pridat', label: 'Přidat kartu', href: href.pridat },
    { key: 'import', label: 'Nahrát tabulku', href: href.import },
  ];
  return <PageTabs label={shop ? 'Sklad' : 'Sbírka'} current={href[current]} tabs={allowed ? tabs.filter((t) => allowed.includes(t.key)) : tabs} />;
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
