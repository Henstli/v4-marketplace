import Link from 'next/link';
import { Ava } from '@/components/orders/Ava';
import { ExpiryStatus } from '@/components/orders/Expiry';
import { OfferActions } from '@/components/orders/OfferActions';
import { ButtonLink, Status } from '@/components/trezor';
import { formatDateTime, formatNumber } from '@/lib/format';
import styles from './orders.module.css';


type CardRef = { name: string; slug: string; image_url: string | null; game_id: string | null; number: string | null; card_sets: { code: string | null; name: string | null } | Array<{ code: string | null; name: string | null }> | null };
export interface Offer {
  id: string; listing_id: string; buyer_id: string; seller_id: string; quantity: number; price_czk: number; last_by: string; status: string; expires_at: string; order_id: string | null; created_at: string;
  listings: { price_czk: number; condition: string | null; language: string | null; quantity: number; cards: CardRef | CardRef[] | null } | null;
}

const kc = (n: number) => `${formatNumber(n)} Kč`;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const LANG: Record<string, string> = { en: 'anglicky', cs: 'česky', de: 'německy', ja: 'japonsky', fr: 'francouzsky', it: 'italsky', es: 'španělsky', pl: 'polsky', ko: 'korejsky', zh: 'čínsky' };
const STATUS: Record<string, string> = { accepted: 'Přijato', declined: 'Odmítnuto', cancelled: 'Staženo', expired: 'Vypršelo' };

export interface OfferViewData {
  offer: Offer;
  role: 'buyer' | 'seller';
  uid: string;
  otherId: string;
  other: { display_name: string | null; kind: string | null } | null;
  rounds: Array<{ sender_id: string | null; offer_price: number | null; created_at: string }>;
  order: { number: number } | null;
}

/** Detail návrhu ceny (DS Orders › Detail návrhu): Přijmout, Odmítnout a Protinávrh přímo v rámečku Co teď. */
export function OfferView({ offer, role, uid, otherId, other, rounds, order }: OfferViewData) {
  const otherName = other?.display_name ?? 'smazaný účet';
  const listing = one(offer.listings);
  const card = one(listing?.cards);
  const set = one(card?.card_sets);
  const open = offer.status === 'open' && Date.parse(offer.expires_at) > Date.now();
  const myTurn = open && offer.last_by !== uid;
  const listPrice = listing ? listing.price_czk * offer.quantity : null;
  const diff = listPrice != null ? offer.price_czk - listPrice : 0;
  const tab = role === 'buyer' ? 'nakupy' : 'prodeje';
  const history = rounds ?? [];
  const lastName = offer.last_by === uid ? 'Váš návrh' : `${otherName} nabízí`;

  return (
    <div className={`container ${styles.list}`}>
      <Link href={`/objednavky?tab=${tab}`} className="tz-ord-crumb">← Objednávky › {role === 'buyer' ? 'Nákupy' : 'Prodeje'}</Link>
      <header className="tz-ord-head">
        <div>
          <h1 className="t-heading-l">
            Návrh ceny
            {open ? <ExpiryStatus expiresAt={offer.expires_at} role={myTurn ? 'seller' : 'buyer'} label={myTurn ? 'Odpovězte' : 'Čeká na odpověď'} act="Odpovězte do" /> : <Status tone={offer.status === 'accepted' ? 'ok' : 'muted'}>{STATUS[offer.status] ?? 'Vypršelo'}</Status>}
          </h1>
          <div className="tz-ord-headsub">
            {role === 'buyer' ? 'Prodejce' : 'Od'} <Ava id={otherId} name={otherName} />{otherName} · {card?.name ?? 'Karta'}{history.length > 1 ? ` · ${history.length}. kolo` : ''}
          </div>
        </div>
        <div className="tz-ord-total">{kc(offer.price_czk)}<small>{offer.quantity} {offer.quantity === 1 ? 'kus' : offer.quantity <= 4 ? 'kusy' : 'kusů'}</small></div>
      </header>

      <section className="tz-ord-now" data-tone={open ? (myTurn ? undefined : 'end') : 'end'} aria-labelledby="co-ted">
        <div className="tz-ord-now-top">
          <div className="tz-ord-now-tx">
            <p className="tz-ord-now-lbl">{open ? 'Co teď' : 'Ukončeno'}</p>
            <h2 id="co-ted">
              {open ? (myTurn ? `${lastName} ${kc(offer.price_czk)}` : `Čekáte na odpověď: ${otherName}`)
                : offer.status === 'accepted' ? 'Cena je dohodnutá' : offer.status === 'declined' ? 'Návrh byl odmítnut' : offer.status === 'cancelled' ? 'Návrh byl stažen' : 'Návrh vypršel'}
            </h2>
            <p>
              {open
                ? myTurn
                  ? `Za ${offer.quantity} ${offer.quantity === 1 ? 'kus' : 'ks'}. Když přijmete, vznikne rovnou potvrzená objednávka${role === 'seller' ? ' a kupující zaplatí' : ' a zaplatíte předem'}.`
                  : `Navrhli jste ${kc(offer.price_czk)}. ${otherName} může přijmout, odmítnout, nebo poslat jinou cenu.`
                : offer.status === 'accepted' ? 'Z návrhu vznikla objednávka.' : 'Můžete poslat nový návrh u nabídky nebo ve zprávách.'}
            </p>
            {listPrice != null ? (
              <div className="tz-ord-cmp">
                <span>{role === 'seller' ? 'Vaše cena' : 'Cena v nabídce'}</span><s>{kc(listPrice)}</s>
                <span>Návrh</span>
                <span><b>{kc(offer.price_czk)}</b>{diff ? <> <span className="down">{diff > 0 ? '+' : '−'}{kc(Math.abs(diff))} ({diff > 0 ? '+' : '−'}{Math.round(Math.abs(diff) / listPrice * 100)} %)</span></> : null}</span>
              </div>
            ) : null}
          </div>
          {open ? (
            <OfferActions offerId={offer.id} listingId={offer.listing_id} quantity={offer.quantity} price={offer.price_czk} role={role} buyerId={offer.buyer_id} myTurn={myTurn} />
          ) : order?.number ? (
            <div className="tz-ord-now-acts"><ButtonLink href={`/objednavky/${order.number}`}>Zobrazit objednávku</ButtonLink></div>
          ) : null}
        </div>
      </section>

      <div className="tz-ord-grid">
        <div className="tz-ord-col">
          <section className="tz-ord-box" aria-labelledby="karta">
            <div className="tz-ord-box-h"><h2 id="karta">Karta</h2></div>
            <div className="tz-ord-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {card?.image_url ? <img src={card.image_url} alt={card.name} /> : <span className="tz-ord-ph" style={{ background: card?.game_id ? `var(--game-${card.game_id}-art)` : 'var(--surface-sunken)' }} />}
              <div>
                <h3>{card?.name ?? 'Karta'}</h3>
                <p>
                  {[set?.name, [set?.code?.toUpperCase(), card?.number].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}<br />
                  {[listing?.condition ? `Stav ${listing.condition}` : null, listing?.language ? LANG[listing.language] ?? listing.language : null].filter(Boolean).join(' · ')}<br />
                  {listing ? `${role === 'seller' ? 'Vaše nabídka' : 'Nabídka'}: ${kc(listing.price_czk)}, skladem ${listing.quantity} ks` : null}
                </p>
                {card?.slug ? <Link href={`/karty/${card.slug}`} className="tz-ord-more">Zobrazit nabídku ›</Link> : null}
              </div>
            </div>
          </section>
          {history.length ? (
            <section className="tz-ord-box" aria-labelledby="prubeh">
              <div className="tz-ord-box-h"><h2 id="prubeh">Průběh návrhu</h2></div>
              <ol className="tz-ord-tl">
                {history.map((h, n) => (
                  <li key={n}>
                    <i />
                    <div>
                      <b>{h.sender_id === uid ? (n === history.length - 1 ? 'Váš návrh' : 'Váš protinávrh') : `Návrh od ${otherName}`}: {kc(h.offer_price as number)}</b>
                      <span>{formatDateTime(h.created_at as string)}{n === 0 && myTurn ? ' · čeká na vás' : ''}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
        <aside className="tz-ord-col">
          <section className="tz-ord-box" aria-labelledby="strana">
            <div className="tz-ord-box-h"><h2 id="strana">{role === 'buyer' ? 'Prodejce' : 'Kupující'}</h2></div>
            <div className="tz-ord-party">
              <Ava id={otherId} name={otherName} size="l" />
              <div>
                <b>{role === 'buyer' ? <Link href={`/prodejci/${otherId}`}>{otherName}</Link> : otherName}</b>
                <span>{other?.kind === 'shop' ? 'Obchod' : 'Sběratel'}</span>
              </div>
            </div>
            <ButtonLink href={`/zpravy/${otherId}`} variant="secondary" className="tz-ord-wide">{role === 'buyer' ? 'Napsat prodejci' : 'Napsat kupujícímu'}</ButtonLink>
            <div className="tz-ord-links"><Link href="/podpora">Napsat podpoře</Link></div>
          </section>
          {open ? (
            <section className="tz-ord-box" aria-labelledby="po-prijeti">
              <div className="tz-ord-box-h"><h2 id="po-prijeti">Po přijetí</h2></div>
              <p className="tz-ord-dl">
                {role === 'seller'
                  ? 'Objednávka se vytvoří s vaší nejlevnější dopravou a převodem předem. Kupující ji uvidí v Nákupech a zaplatí.'
                  : 'Vznikne potvrzená objednávka s nejlevnější dopravou prodejce. Zaplatíte předem a prodejce kartu odešle.'}
              </p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
