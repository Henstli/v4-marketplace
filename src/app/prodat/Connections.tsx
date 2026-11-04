import Link from 'next/link';

type C = [k: string, name: string, color: string, text: string, flow: string, tag: string];

const SHOP: C[] = [
  ['S', 'Shoptet', '#9be3ff', 'Nejčastější e-shop v ČR. Doplněk V4cards ve Shoptetu, přihlášení jedním klikem.', 'Počty ↔ · Ceny → · Prodeje ↔', 'Doporučeno'],
  ['W', 'WooCommerce', '#c8a6ff', 'WordPress e-shopy. Náš plugin, klíč z nastavení WooCommerce.', 'Počty ↔ · Ceny → · Prodeje ↔', ''],
  ['F', 'Shopify', '#a6e36b', 'Klíč z vlastní aplikace v Shopify.', 'Počty ↔ · Ceny → · Prodeje ↔', ''],
  ['U', 'Upgates a další', '#ffc86b', 'Přes XML feed (Heureka/Zboží), který e-shop už má.', 'Počty → · Ceny →', 'Jen čtení'],
  ['T', 'Tabulka', '#7fe0a6', 'Excel nebo CSV, i export z Cardmarketu. Sloupce poznáme sami.', 'Počty → · Ceny →', ''],
  ['A', 'Vlastní systém (API)', '#e8ecf1', 'Pro obchody s vlastním skladem. API klíč a dokumentace.', 'Počty ↔ · Ceny ↔ · Prodeje ↔', 'Pro'],
];
const COLLECTOR: C[] = [
  ['T', 'Tabulka', '#7fe0a6', 'Excel nebo CSV nahrajete jednou. Sloupce poznáme sami.', 'Počty → · Ceny →', ''],
  ['M', 'ManaBox', '#ff9b7a', 'Magic. Skenujete karty telefonem. Export sbírky do CSV převedeme celý.', 'Sbírka →', 'Soubor'],
  ['X', 'Moxfield', '#b58cff', 'Magic. Sbírka i balíčky.', 'Sbírka →', 'Soubor'],
  ['R', 'Archidekt', '#6aa9ff', 'Magic. Export sbírky.', 'Sbírka →', 'Soubor'],
  ['D', 'Dragon Shield', '#7fd6e8', 'Pokémon, Magic, Lorcana, One Piece. Skener v telefonu, export do CSV.', 'Sbírka →', 'Soubor'],
  ['C', 'Collectr', '#ffd36b', 'Pokémon, One Piece, Lorcana a sport. Export portfolia do CSV.', 'Sbírka →', 'Soubor'],
  ['K', 'Cardmarket', '#9aa3ad', 'Stažený seznam vašich nabídek.', 'Sbírka →', 'Soubor'],
];
const CARRIERS: [string, string, string, string][] = [
  ['Z', 'Zásilkovna', '#ff7a72', 'Klíč API najdete v klientské sekci Zásilkovny.'],
  ['P', 'PPL', '#ffd36b', 'Přihlašovací údaje k PPL API (MyAPI). Výdejní místa, boxy i na adresu.'],
  ['B', 'Česká pošta / Balíkovna', '#8fc1ff', 'Klíč z aplikace Podání online. Balíkovna, Balík Do ruky i doporučený dopis.'],
  ['G', 'GLS', '#7aa7ff', 'Přihlašovací údaje k MyGLS API.'],
  ['Q', 'DPD', '#ff8a8a', 'Klíč k DPD API z klientského portálu DPD.'],
];
const BILLING: [string, string, string, string][] = [
  ['K', 'Fakturoid', '#ff9b7a', 'Faktura se založí sama, platbu spáruje Fakturoid podle variabilního symbolu.'],
  ['D', 'iDoklad', '#7ab8ff', 'Stejně jako Fakturoid. Klíč najdete v nastavení iDokladu.'],
  ['R', 'SuperFaktura', '#ffb36b', 'Nejrozšířenější na Slovensku, umí i Česko. Klíč v nastavení účtu.'],
  ['X', 'ABRA Flexi', '#b58cff', 'Pro obchody s ABRA Flexi. Uživatel s přístupem k API.'],
  ['O', 'Pohoda', '#7fd6e8', 'Přes doplněk mServer, který Pohoda už obsahuje.'],
  ['M', 'Money S3 a S5', '#c9d36a', 'Výměna dat přes XML, v Money ji zapnete v nastavení.'],
];

const soon = <span style={{ display: 'flex', gap: 8 }}><span className="btn sm" aria-disabled="true" style={{ opacity: 0.55, cursor: 'default' }} title="Připravujeme">Brzy</span></span>;

/** Napojení podle prototypu. Co zatím nefunguje, má místo Napojit poctivé Brzy. */
export function Connections({ back, shop, obchod }: { back: string; shop: boolean; obchod: string }) {
  const imp = obchod ? `/prodat/import?obchod=${obchod}` : '/prodat/import';
  const card = (k: string, n: string, c: string, p: string, f: string, tag: string, action: React.ReactNode) => (
    <div key={n} className="con">
      <div className="ch"><span className="lg" style={{ background: c }}>{k}</span><b>{n}</b>{tag ? <em>{tag}</em> : null}</div>
      <p>{p}</p><small>{f}</small>{action}
    </div>
  );
  return (
    <>
      <div className="top"><div><Link className="btn sm g" href={back} style={{ paddingLeft: 0 }}>← Zpět {shop ? 'na sklad' : 'do sbírky'}</Link><h1>Napojení</h1></div></div>
      <p style={{ color: 'var(--ink-muted)', maxWidth: 720 }}>
        {shop
          ? 'Šipky říkají, kterým směrem data tečou. ↔ znamená obousměrně: prodej na e-shopu sníží počet u nás a prodej u nás sníží počet v e-shopu.'
          : 'Sbírku nahrajete z tabulky nebo ze sběratelské aplikace. Aplikace zatím jen exportem do souboru, karty spárujeme s katalogem.'}
      </p>
      <div className="cons">
        {(shop ? SHOP : COLLECTOR).map(([k, n, c, p, f, t]) => card(k, n, c, p, f, t,
          k === 'T' || !shop ? <span style={{ display: 'flex', gap: 8 }}><Link className="btn sm" href={imp}>{k === 'T' ? 'Nahrát' : 'Nahrát export'}</Link></span>
            : k === 'S' ? <span style={{ display: 'flex', gap: 8 }}><span className="btn sm" style={{ opacity: 0.55, cursor: 'default' }} title="Čeká na partnerskou registraci V4cards u Shoptetu">Brzy</span></span> : soon))}
      </div>
      {shop ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, margin: '26px 0 12px' }}>
            <h3 style={{ font: '700 18px var(--fd)', margin: 0 }}>Dopravci</h3>
            <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>Váš vlastní účet. Do té doby zadáte v K odeslání číslo zásilky ručně a vytisknete adresní štítky.</span>
          </div>
          <div className="cons">{CARRIERS.map(([k, n, c, p]) => card(k, n, c, p, 'Štítky → · Sledování ←', '', soon))}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, margin: '26px 0 4px' }}>
            <h3 style={{ font: '700 18px var(--fd)', margin: 0 }}>Fakturace</h3>
            <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>Pro obchody bez e-shopu, nebo když váš e-shop faktury nevystavuje.</span>
          </div>
          <p style={{ color: 'var(--ink-muted)', maxWidth: 720, margin: '0 0 12px' }}>K objednávce přes V4cards se faktura vystaví sama ve vaší fakturační aplikaci. Ta má napojenou vaši banku, platbu spáruje a my jen převezmeme „zaplaceno“.</p>
          <div className="cons">{BILLING.map(([k, n, c, p]) => card(k, n, c, p, 'Faktury → · Zaplaceno ←', '', soon))}</div>
        </>
      ) : null}
    </>
  );
}
