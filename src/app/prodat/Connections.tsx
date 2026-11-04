import Link from 'next/link';

type Conn = { k: string; name: string; text: string; flow: string; state: 'live' | 'soon'; note?: string; href?: string; action?: string };

const SHOPS: Conn[] = [
  { k: 'T', name: 'Tabulka', text: 'Excel nebo CSV, i export z Cardmarketu. Sloupce poznáme sami.', flow: 'Počty → · Ceny →', state: 'live', href: '/prodat/import', action: 'Nahrát tabulku' },
  { k: 'S', name: 'Shoptet', text: 'Nejčastější e-shop v ČR. Doplněk V4cards ve Shoptetu, přihlášení jedním klikem.', flow: 'Počty ↔ · Ceny → · Prodeje ↔', state: 'soon', note: 'Čeká na partnerskou registraci V4cards u Shoptetu.' },
  { k: 'W', name: 'WooCommerce', text: 'WordPress e-shopy. Klíč z nastavení WooCommerce.', flow: 'Počty ↔ · Ceny → · Prodeje ↔', state: 'soon' },
  { k: 'F', name: 'Shopify', text: 'Klíč z vlastní aplikace v Shopify.', flow: 'Počty ↔ · Ceny → · Prodeje ↔', state: 'soon' },
  { k: 'U', name: 'Upgates a další', text: 'Přes XML feed (Heureka, Zboží), který e-shop už má.', flow: 'Počty → · Ceny →', state: 'soon' },
  { k: 'A', name: 'Vlastní systém (API)', text: 'Pro obchody s vlastním skladem. API klíč a dokumentace.', flow: 'Počty ↔ · Ceny ↔ · Prodeje ↔', state: 'soon' },
];
const CARRIERS: Conn[] = [
  { k: 'Z', name: 'Zásilkovna', text: 'Štítek z objednávky přes váš účet u Zásilkovny.', flow: 'Štítky · stav zásilky', state: 'soon' },
  { k: 'B', name: 'Česká pošta a Balíkovna', text: 'Podací data a štítky přes váš účet u České pošty.', flow: 'Štítky · stav zásilky', state: 'soon' },
  { k: 'P', name: 'PPL', text: 'Štítky přes váš účet PPL.', flow: 'Štítky · stav zásilky', state: 'soon' },
  { k: 'D', name: 'DPD a GLS', text: 'Štítky přes váš účet u dopravce.', flow: 'Štítky · stav zásilky', state: 'soon' },
];
const BILLING: Conn[] = [
  { k: 'F', name: 'Fakturoid', text: 'Faktura k objednávce přes V4cards se založí sama, Fakturoid spáruje platbu a my převezmeme Zaplaceno.', flow: 'Faktury → · Zaplaceno ←', state: 'soon' },
  { k: 'I', name: 'iDoklad', text: 'Stejně jako Fakturoid: faktura sama, párování platby v iDokladu.', flow: 'Faktury → · Zaplaceno ←', state: 'soon' },
];

function Grid({ list }: { list: Conn[] }) {
  return (
    <div className="tz-stk-cons">
      {list.map((c) => (
        <div key={c.name} className={`tz-stk-con${c.state === 'live' ? ' is-live' : ''}`}>
          <header><span className="tz-stk-lg">{c.k}</span><b>{c.name}</b>{c.state === 'live' ? <em className="tz-stk-pay is-ok">Funguje</em> : <em className="tz-acct-soon">Brzy</em>}</header>
          <p>{c.text}</p>
          <small className="tz-stk-code">{c.flow}</small>
          {c.note ? <small className="tz-stk-muted">{c.note}</small> : null}
          {c.href ? <Link className="tz-btn tz-btn-secondary tz-btn-sm" href={c.href}>{c.action}</Link> : null}
        </div>
      ))}
    </div>
  );
}

/** Napojení obchodu: e-shopy, dopravci, fakturace a exporty. Co zatím nefunguje, je poctivě označené Brzy. */
export function Connections({ isOwner }: { isOwner: boolean }) {
  return (
    <>
      <p className="t-small muted" style={{ maxWidth: 760 }}>
        Šipky říkají, kterým směrem data tečou. ↔ znamená obousměrně: prodej na e-shopu sníží počet u nás a prodej u nás sníží počet v e-shopu.
        Peníze ani zásilky přes V4cards nejdou: štítky platíte svému dopravci a faktury vystavuje vaše fakturace.
      </p>
      <section className="tz-stk-box"><header><b>E-shop a sklad</b></header><Grid list={SHOPS} /></section>
      <section className="tz-stk-box">
        <header><b>Dopravci</b><span className="t-small muted">Váš vlastní účet u dopravce. Do té doby: v K odeslání zadáte číslo zásilky ručně a vytisknete adresní štítky.</span></header>
        <Grid list={CARRIERS} />
      </section>
      <section className="tz-stk-box">
        <header><b>Fakturace</b><span className="t-small muted">Pro obchody bez e-shopu. Bankovní účet obchodu nikdy nečteme.</span></header>
        <Grid list={BILLING} />
      </section>
      {isOwner ? (
        <section className="tz-stk-box">
          <header><b>Exporty</b><span className="t-small muted">Stáhnete kdykoli, data jsou vaše.</span></header>
          <div className="tz-stk-tools">
            <a className="tz-btn tz-btn-ghost tz-btn-sm" href="/prodat/export" download>Sklad (CSV, jde nahrát zpátky)</a>
            <a className="tz-btn tz-btn-ghost tz-btn-sm" href="/prodat/export?druh=ucetni" download>Přehled pro účetní</a>
            <a className="tz-btn tz-btn-ghost tz-btn-sm" href="/prodat/export?druh=pojisteni" download>Přehled pro pojištění</a>
            <a className="tz-btn tz-btn-ghost tz-btn-sm" href="/prodat/export?druh=deckbuilder" download>Pro deckbuildery (Moxfield)</a>
          </div>
        </section>
      ) : null}
    </>
  );
}
