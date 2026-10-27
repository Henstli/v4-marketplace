import Link from 'next/link';
import { Achievements, ButtonLink, CardTag, ChipLink, Price, SellerBadge, ShopDivider, ShopHeader, ShopSection, ShopTicker, shopStyle } from '@/components/trezor';
import { ProposePrice } from '@/components/offers/ProposePrice';
import { AddToCartButton } from '@/components/cart/AddToCartButton';
import { formatNumber, plural } from '@/lib/format';
import { GAMES, getGame } from '@/lib/games';
import { PLANS } from '@/lib/plans';
import {
  blockInfo, safeColor, shopHref, visibleTabs, COLLECTION_SORTS, SHOP_TYPES,
  type CollectionSort, type ShopBlock, type ShopCollection, type ShopDesign,
} from '@/lib/shop-config';
import {
  getCardsByIds, getGameCounts, getShopListings, getShopReviews, mediaImage, searchShopListings,
  type ListingFilter, type ShopListing, type ShopProfile,
} from '@/lib/shop';
import { AutoStrip, Countdown, HoloEffect, MapEmbed, MessageSeller, PreviewBridge, SiteHeaderHeight, VideoEmbed } from './ShopClient';
import { CONDITION_NAMES, LANGUAGE_NAMES, type Language } from '@/lib/types';
import type { GameId } from '@/lib/games';
import styles from './shop.module.css';

export interface StockQuery {
  /** Pohled: 'nabidka' (celá nabídka) nebo 'onas'; bez něj Přehled */
  zalozka?: string;
  q?: string;
  hra?: string;
  kolekce?: string;
  /** Celý obsah jednoho bloku (Novinky, Nejlevnější, Doporučujeme) */
  blok?: string;
  razeni?: string;
  strana?: string;
}

const STOCK_PAGE = 24;

const FONT_URLS: Record<string, string> = {
  classic: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap',
  sport: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&display=swap',
};

function sellerMeta(p: ShopProfile, offers: number) {
  const s = p.seller;
  const type = SHOP_TYPES.find((t) => t.id === p.config.design.shopType && t.id)?.name ?? (s.kind === 'shop' ? 'Obchod' : 'Sběratel');
  return (
    <>
      {type} · {s.country === 'SK' ? 'Slovensko' : 'Česko'} ·{' '}
      {s.rating != null ? <>{formatNumber(s.rating, 1)}&nbsp;% kladných z {plural(s.sales, ['hodnocení', 'hodnocení', 'hodnocení'])}</> : 'Zatím bez hodnocení'}
      {' · '}{plural(offers, ['karta v nabídce', 'karty v nabídce', 'karet v nabídce'])}
    </>
  );
}

function cartItem(l: ShopListing, p: ShopProfile, price: number) {
  return {
    listingId: l.id,
    cardSlug: l.card.slug,
    cardName: l.card.name,
    setLabel: `${l.card.setCode} ${l.card.number}`,
    sellerId: p.seller.id,
    sellerName: p.seller.name,
    condition: l.condition + (l.graded ? ` · ${l.graded}` : ''),
    language: LANGUAGE_NAMES[l.language] ?? l.language,
    price,
    maxQuantity: l.quantity,
    image: l.card.image,
    game: l.card.game,
  };
}

function Art({ image, game, name, holo, tag }: { image?: string; game: GameId; name: string; holo?: boolean; tag?: React.ReactNode }) {
  return image ? (
    <div className={`tz-tile-art tz-tile-art-photo ${holo ? 'tz-holo' : ''}`} style={{ position: 'relative' }}>
      {tag}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt={name} loading="lazy" className="tz-tile-img" />
    </div>
  ) : (
    <div className={`tz-tile-art ${holo ? 'tz-holo' : ''}`} style={{ position: 'relative', background: `var(--game-${game}-art, var(--surface-sunken))` }}>
      {tag}
      <div className="tz-tile-frame">{tag ? null : getGame(game)?.label}</div>
    </div>
  );
}

const WEEK = 7 * 24 * 3600 * 1000;

/** Štítek nabídky: vlastní štítek obchodu, jinak automaticky Poslední kus nebo Novinka. */
function listingTag(l: ShopListing, d: ShopDesign) {
  const i = d.customTags.findIndex((t) => t.ids.includes(l.id));
  if (i >= 0) return <span className="tz-card-tag tz-card-tag-custom" data-i={i}>{d.customTags[i].label}</span>;
  if (!d.tagsAuto) return null;
  if (l.quantity === 1) return <CardTag kind="last">Poslední kus</CardTag>;
  if (Date.now() - new Date(l.createdAt).getTime() < WEEK) return <CardTag kind="new">Novinka</CardTag>;
  return null;
}

function ListingTile({ l, d, p }: { l: ShopListing; d: ShopDesign; p?: ShopProfile }) {
  const body = (
    <>
      <Art image={l.card.image} game={l.card.game} name={l.card.name} holo={d.holo} tag={listingTag(l, d)} />
      <div>
        <div className="tz-tile-name">{l.card.name}</div>
        <div className="tz-tile-set">{l.card.setCode} {l.card.number}</div>
      </div>
      <div className="tz-tile-row">
        {l.price != null ? <Price amount={l.price} /> : <span className="muted">Cena dohodou</span>}
        <span className="code" title={CONDITION_NAMES[l.condition]}>{l.condition}{l.graded ? ` · ${l.graded}` : ''}</span>
      </div>
    </>
  );
  if (!p) return <Link className="tz-tile" href={`/karty/${l.card.slug}`}>{body}</Link>;
  // U ceny dohodou místo košíku „Nabídnout cenu“ (Šimon 27. 10.).
  if (l.price == null) {
    return (
      <div className="tz-tile">
        <Link className="tz-tile-link" href={`/karty/${l.card.slug}`}>{body}</Link>
        <ProposePrice listingId={l.id} sellerId={p.seller.id} max={l.quantity} className="tz-tile-buy" />
      </div>
    );
  }
  // S košíkem: odkaz a tlačítko vedle sebe, tlačítko nesmí být uvnitř odkazu.
  return (
    <div className="tz-tile">
      <Link className="tz-tile-link" href={`/karty/${l.card.slug}`}>{body}</Link>
      <AddToCartButton item={cartItem(l, p, l.price)} className="tz-tile-buy" />
    </div>
  );
}

/** Nabídky v bloku: mřížka na dva řádky s odkazem na celý výběr, nebo pás, který jede sám. */
function Listings({ items, variant, d, p, more }: { items: ShopListing[]; variant: string; d: ShopDesign; p?: ShopProfile; more?: string }) {
  if (variant === 'strip') {
    return <AutoStrip>{items.map((l) => <ListingTile key={l.id} l={l} d={d} p={p} />)}</AutoStrip>;
  }
  return (
    <>
      <div className={`${styles.grid} tz-grid-2rows`}>
        {items.map((l) => <ListingTile key={l.id} l={l} d={d} p={p} />)}
      </div>
      {more && items.length > 4 ? (
        <div className={styles.pager}><ButtonLink href={more} variant="secondary">Zobrazit vše</ButtonLink></div>
      ) : null}
    </>
  );
}

function blockTitle(b: ShopBlock): string {
  return b.title || blockInfo(b.type)?.name || '';
}

/** Filtr nabídek pro celý obsah bloku (?blok=), nebo null, když blok nic takového nemá. */
function blockFilter(b: ShopBlock): ListingFilter | null {
  if (b.type === 'newest') return { sort: 'new' };
  if (b.type === 'cheap') return { sort: 'cheap', priceMax: b.data.cheap?.maxPrice ?? 100 };
  if (b.type === 'featured') return { ids: b.data.featured?.listingIds ?? [] };
  return null;
}

function collectionFilter(c: ShopCollection): ListingFilter {
  if (c.listingIds.length) return { ids: c.listingIds, sort: c.sort };
  return {
    q: c.q || undefined, game: c.game || undefined, set: c.set || undefined,
    condition: c.condition || undefined, language: c.language || undefined,
    priceMin: c.priceMin, priceMax: c.priceMax, sort: c.sort,
  };
}

const MONTHS = ['LED', 'ÚNO', 'BŘE', 'DUB', 'KVĚ', 'ČVN', 'ČVC', 'SRP', 'ZÁŘ', 'ŘÍJ', 'LIS', 'PRO'];

function daysUntil(date: string): string {
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  const n = Math.round((new Date(date).getTime() - today) / 86_400_000);
  return n <= 0 ? 'Dnes' : n === 1 ? 'Zítra' : `Za ${plural(n, ['den', 'dny', 'dní'])}`;
}

async function Block({ b, p, base }: { b: ShopBlock; p: ShopProfile; base: string }) {
  const sid = p.seller.id;
  const d = p.config.design;
  const more = `${base}?blok=${b.id}`;
  switch (b.type) {
    case 'notice': {
      const n = b.data.notice;
      if (!n?.title && !n?.text) return null;
      if (n.until && n.until < new Date().toISOString().slice(0, 10)) return null;
      const label = n.until ? `PLATÍ DO ${n.until.split('-').reverse().map(Number).join('. ')}` : 'OZNÁMENÍ';
      if (b.variant === 'bar') {
        return (
          <section aria-label="Oznámení" className="tz-notice-bar">
            <span className="tz-notice-label">{label}</span>
            <strong>{n.title}</strong>
            {n.text ? <span style={{ opacity: 0.85 }}>{n.text}</span> : null}
          </section>
        );
      }
      return (
        <section aria-label="Oznámení" className="tz-notice">
          <span className="tz-notice-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" /><path d="M15 9a4 4 0 0 1 0 6" /><path d="M18 6a8 8 0 0 1 0 12" /></svg>
          </span>
          <div className="tz-notice-body">
            <span className="tz-notice-label">{label}</span>
            {n.title ? <p className="tz-notice-title">{n.title}</p> : null}
            {n.text ? <p className="muted" style={{ margin: 0, whiteSpace: 'pre-line' }}>{n.text}</p> : null}
          </div>
        </section>
      );
    }
    case 'spotlight': {
      const s = b.data.spotlight;
      if (!s?.listingId) return null;
      const [l] = await getShopListings(sid, { ids: [s.listingId], limit: 1 });
      if (!l) return null;
      return (
        <section aria-label={blockTitle(b)} className={`${styles.spot} ${b.variant === 'right' ? styles.spotRight : ''}`}>
          <div className={`${styles.spotArt} ${d.holo ? 'tz-holo' : ''}`} style={l.card.image ? undefined : { background: `var(--game-${l.card.game}-art, var(--surface-sunken))` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {l.card.image ? <img src={l.card.image} alt={l.card.name} /> : <span className="tz-tile-frame">{getGame(l.card.game)?.label}</span>}
          </div>
          <div className={styles.spotText}>
            <span className="t-label muted">{blockTitle(b).toUpperCase()}</span>
            <h2 className={styles.spotName}>{l.card.name}</h2>
            <span className="code">{l.card.setCode} {l.card.number} · {l.condition}{l.graded ? ` · ${l.graded}` : ''} · {LANGUAGE_NAMES[l.language] ?? l.language}</span>
            {s.story ? <p className="muted" style={{ margin: 0, whiteSpace: 'pre-line', maxWidth: 560 }}>{s.story}</p> : null}
            <div className={styles.spotBuy}>
              {l.price != null ? <Price amount={l.price} size="lg" /> : <span className="t-price-l">Cena dohodou</span>}
              <ButtonLink href={`/karty/${l.card.slug}`} variant="secondary">Detail karty</ButtonLink>
            </div>
          </div>
        </section>
      );
    }
    case 'featured': {
      const items = await getShopListings(sid, { ids: b.data.featured?.listingIds ?? [] });
      if (!items.length) return null;
      return <ShopSection title={blockTitle(b)} note="Vybírá prodejce"><Listings items={items} variant={b.variant} d={d} p={p} more={more} /></ShopSection>;
    }
    case 'newest': {
      const items = await getShopListings(sid, { order: 'new', limit: 16 });
      if (!items.length) return null;
      return <ShopSection title={blockTitle(b)} note="Poslední přidané nabídky"><Listings items={items} variant={b.variant} d={d} p={p} more={more} /></ShopSection>;
    }
    case 'cheap': {
      const max = b.data.cheap?.maxPrice ?? 100;
      const items = await getShopListings(sid, { order: 'cheap', maxPrice: max, limit: 16 });
      if (!items.length) return null;
      return <ShopSection title={blockTitle(b)} note={`Do ${formatNumber(max)} Kč`}><Listings items={items} variant={b.variant} d={d} p={p} more={more} /></ShopSection>;
    }
    case 'games': {
      const counts = await getGameCounts(sid);
      const picked = b.data.games?.games ?? [];
      const ordered = GAMES
        .filter((g) => !picked.length || picked.includes(g.id))
        .map((g) => ({ g, n: counts.find((c) => c.game === g.id)?.cards ?? 0 }))
        .filter((x) => x.n > 0);
      if (!ordered.length) return null;
      const href = (id: string) => `${base}?zalozka=nabidka&hra=${id}`;
      if (b.variant === 'chips') {
        return (
          <ShopSection title={blockTitle(b)}>
            <div className="tz-coll-chips">
              {ordered.map(({ g, n }) => (
                <Link key={g.id} href={href(g.id)} className="tz-coll-chip">
                  <span className={styles.dot} style={{ background: g.dot }} aria-hidden="true" />{g.name}<span className="muted" style={{ fontWeight: 500 }}>{formatNumber(n)}</span>
                </Link>
              ))}
            </div>
          </ShopSection>
        );
      }
      if (b.variant === 'cards') {
        return (
          <ShopSection title={blockTitle(b)}>
            <div className="tz-coll-cards">
              {ordered.map(({ g, n }) => (
                <Link key={g.id} href={href(g.id)} className="tz-coll-card" style={{ background: `linear-gradient(135deg, ${g.dot}, color-mix(in srgb, ${g.dot} 40%, #0b0d12))` }}>
                  <strong>{g.name}</strong>
                  <span>{plural(n, ['karta', 'karty', 'karet'])}</span>
                </Link>
              ))}
            </div>
          </ShopSection>
        );
      }
      return (
        <ShopSection title={blockTitle(b)}>
          <div className={styles.tiles}>
            {ordered.map(({ g, n }) => (
              <Link key={g.id} href={href(g.id)} className={styles.tile}>
                <span className={styles.tileTitle}><span className={styles.dot} style={{ background: g.dot }} aria-hidden="true" />{g.name}</span>
                <span className="t-price-l">{formatNumber(n)}</span>
                <span className="t-small muted">{plural(n, ['karta', 'karty', 'karet'])}</span>
              </Link>
            ))}
          </div>
        </ShopSection>
      );
    }
    case 'collections': {
      const cols = p.config.collections;
      if (!cols.length) return null;
      if (b.variant === 'chips') {
        return (
          <ShopSection title={blockTitle(b)}>
            <div className="tz-coll-chips">
              {cols.map((c) => <Link key={c.id} href={`${base}?kolekce=${c.id}`} className="tz-coll-chip">{c.name}</Link>)}
            </div>
          </ShopSection>
        );
      }
      return (
        <ShopSection title={blockTitle(b)}>
          <div className={b.variant === 'cards' ? 'tz-coll-cards' : styles.tiles}>
            {cols.map((c) => (
              <Link key={c.id} href={`${base}?kolekce=${c.id}`} className={b.variant === 'cards' ? 'tz-coll-card' : styles.tile}>
                {b.variant === 'cards' ? <strong>{c.name}</strong> : <span className={styles.tileTitle}>{c.name}</span>}
                <span className={b.variant === 'cards' ? undefined : 't-small muted'}>{c.desc || collectionLabel(c)}</span>
              </Link>
            ))}
          </div>
        </ShopSection>
      );
    }
    case 'events': {
      const today = new Date().toISOString().slice(0, 10);
      const items = (b.data.events ?? []).filter((e) => !e.date || e.date >= today).sort((x, y) => (x.date || '9').localeCompare(y.date || '9'));
      if (!items.length) return null;
      return (
        <ShopSection title={blockTitle(b)}>
          <div className="tz-events">
            {items.map((e, i) => {
              const [, m, day] = e.date ? e.date.split('-') : ['', '', ''];
              return (
                <div key={i} className="tz-event">
                  {e.date ? (
                    <span className="tz-event-date" aria-hidden="true">
                      <span className="tz-event-month">{MONTHS[Number(m) - 1]}</span>
                      <span className="tz-event-day">{Number(day)}</span>
                    </span>
                  ) : null}
                  <span className="tz-event-text">
                    <strong>{e.title}</strong>
                    {e.info ? <span className="t-small muted">{e.info}</span> : null}
                    {e.date ? <span className="tz-event-when">{daysUntil(e.date)}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </ShopSection>
      );
    }
    case 'photos': {
      const photos = b.data.photos ?? [];
      if (!photos.length) return null;
      return (
        <ShopSection title={blockTitle(b)}>
          <div className="tz-photos" data-n={photos.length}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photos.map((ph) => <img key={ph} src={mediaImage(ph, 1080)!} alt="" loading="lazy" />)}
          </div>
        </ShopSection>
      );
    }
    case 'faq': {
      const items = b.data.faq ?? [];
      if (!items.length) return null;
      return (
        <ShopSection title={blockTitle(b)}>
          <div className={styles.faq}>
            {items.map((f, i) => <details key={i}><summary>{f.q}</summary><p>{f.a}</p></details>)}
          </div>
        </ShopSection>
      );
    }
    case 'showcase': {
      const items = b.data.showcase ?? [];
      const cards = await getCardsByIds(items.map((x) => x.cardId));
      const shown = items.filter((x) => cards.has(x.cardId));
      if (!shown.length) return null;
      return (
        <ShopSection title={blockTitle(b)} note="Ze sbírky, není na prodej">
          <div className="tz-vitrine">
            {shown.map((x) => {
              const c = cards.get(x.cardId)!;
              return (
                <Link key={x.cardId} className="tz-vitrine-item" href={`/karty/${c.slug}`}>
                  <span className="tz-vitrine-slab">
                    <span className="tz-vitrine-label"><span>{c.setCode} {c.number}</span>{x.grade ? <b>{x.grade}</b> : null}</span>
                    <span className={d.holo ? 'tz-holo' : undefined} style={{ display: 'block', borderRadius: '4.8%/3.45%' }}>
                      {c.image
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img className="tz-vitrine-art" src={c.image} alt={c.name} loading="lazy" />
                        : <span className="tz-vitrine-art" style={{ background: `var(--game-${c.game}-art, var(--surface-sunken))` }} />}
                    </span>
                  </span>
                  <span className="tz-vitrine-stand" aria-hidden="true" />
                  <span className="tz-vitrine-name">{c.name}</span>
                  {x.note ? <span className="tz-vitrine-note">{x.note}</span> : null}
                </Link>
              );
            })}
          </div>
        </ShopSection>
      );
    }
    case 'window': {
      const ids = b.data.window?.listingIds ?? [];
      const count = b.variant === '5' ? 5 : 3;
      const items = (await getShopListings(sid, { ids })).slice(0, count);
      if (items.length < 3) return null;
      const n = items.length >= 5 ? 5 : 3;
      return (
        <section aria-label={blockTitle(b)} className="tz-shop-window" data-count={n}>
          {items.slice(0, n).map((l) => (
            <Link key={l.id} href={`/karty/${l.card.slug}`} className="tz-shop-window-card" title={`${l.card.name} · ${l.price != null ? `${formatNumber(l.price)} Kč` : 'cena dohodou'}`}>
              <span className={d.holo ? 'tz-holo' : undefined} style={{ display: 'block' }}>
                {l.card.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={l.card.image} alt={l.card.name} />
                  : <span className="tz-shop-window-art" style={{ background: `var(--game-${l.card.game}-art, var(--surface-sunken))` }} />}
              </span>
            </Link>
          ))}
        </section>
      );
    }
    case 'countdown': {
      const c = b.data.countdown;
      if (!c?.at) return null;
      return (
        <ShopSection title={c.title || blockTitle(b)}>
          <div className="tz-countdown-box">
            <div className="tz-countdown-row">
              {c.text ? <p className="tz-countdown-text">{c.text}</p> : null}
              <Countdown at={c.at} />
            </div>
          </div>
        </ShopSection>
      );
    }
    case 'reviews': {
      const items = await getShopReviews(sid, b.variant === '6' ? 6 : 3);
      if (!items.length) return null;
      return (
        <ShopSection title={blockTitle(b)} note="Z dokončených objednávek">
          <div className={styles.tiles}>
            {items.map((r, i) => (
              <figure key={i} className="tz-review" style={{ margin: 0 }}>
                <span className="tz-review-stars" aria-label={`${r.rating} z 5`}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                <blockquote style={{ margin: 0 }}>„{r.comment}“</blockquote>
                <figcaption className="t-small muted">Ověřený nákup · {new Date(r.date).toLocaleDateString('cs-CZ')}</figcaption>
              </figure>
            ))}
          </div>
        </ShopSection>
      );
    }
    case 'team': {
      const people = b.data.team ?? [];
      if (!people.length) return null;
      return (
        <ShopSection title={blockTitle(b)}>
          <div className="tz-team">
            {people.map((m, i) => (
              <div key={i} className="tz-team-person">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.photo ? <img className="tz-team-photo" src={mediaImage(m.photo, 256)!} alt="" /> : <span className="tz-team-photo" aria-hidden="true" />}
                <strong>{m.name}</strong>
                {m.role ? <span className="t-small muted">{m.role}</span> : null}
                {m.note ? <span className="t-small">{m.note}</span> : null}
              </div>
            ))}
          </div>
        </ShopSection>
      );
    }
    case 'video': {
      const id = b.data.video?.youtube;
      if (!id) return null;
      return <ShopSection title={blockTitle(b)}><VideoEmbed id={id} title={blockTitle(b)} /></ShopSection>;
    }
    case 'map': {
      const address = p.config.store.address;
      if (!address) return null;
      return <ShopSection title={blockTitle(b)}><MapEmbed address={address} /></ShopSection>;
    }
    case 'wanted': {
      const items = b.data.wanted ?? [];
      const cards = await getCardsByIds(items.map((x) => x.cardId));
      const shown = items.filter((x) => cards.has(x.cardId));
      if (!shown.length) return null;
      return (
        <ShopSection title={blockTitle(b)} note="Máte některou? Nabídněte ji prodejci">
          <div className="tz-wanted">
            {shown.map((x) => {
              const c = cards.get(x.cardId)!;
              return (
                <div key={x.cardId} className="tz-wanted-item">
                  <Link href={`/karty/${c.slug}`} className="tz-wanted-link">
                    {c.image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img className="tz-wanted-art" src={c.image} alt={c.name} loading="lazy" />
                      : <span className="tz-wanted-art" style={{ background: `var(--game-${c.game}-art, var(--surface-sunken))` }} />}
                    <span>
                      <strong style={{ display: 'block' }}>{c.name}</strong>
                      <span className="code muted">{c.setCode} {c.number}</span>
                    </span>
                  </Link>
                  {x.maxPrice ? <span className="tz-wanted-price">{formatNumber(x.maxPrice)} Kč{x.qty > 1 ? ` · ${x.qty} ks` : ''}</span> : null}
                  <MessageSeller small sellerId={p.seller.id} label="Nabídnout" text={offerText(c, x.maxPrice)} />
                </div>
              );
            })}
          </div>
        </ShopSection>
      );
    }
  }
}

export function collectionLabel(c: ShopCollection): string {
  if (c.listingIds.length) return `Vybráno ručně · ${plural(c.listingIds.length, ['karta', 'karty', 'karet'])}`;
  const price = c.priceMin && c.priceMax ? `${formatNumber(c.priceMin)}–${formatNumber(c.priceMax)} Kč`
    : c.priceMax ? `do ${formatNumber(c.priceMax)} Kč` : c.priceMin ? `od ${formatNumber(c.priceMin)} Kč` : null;
  return [
    c.game ? getGame(c.game)?.name : null,
    c.set || null,
    price,
    c.condition ? c.condition : null,
    c.language ? LANGUAGE_NAMES[c.language as Language] : null,
    c.q ? `„${c.q}“` : null,
  ].filter(Boolean).join(' · ') || 'Celý sklad';
}

type StockMode =
  | { kind: 'all' }
  | { kind: 'collection'; c: ShopCollection }
  | { kind: 'block'; b: ShopBlock; f: ListingFilter };

/** Nabídka po jednotlivých nabídkách: Celá nabídka, kolekce nebo celý obsah bloku. */
async function Stock({ p, base, query, mode }: { p: ShopProfile; base: string; query: StockQuery; mode: StockMode }) {
  const d = p.config.design;

  const fixed: ListingFilter = mode.kind === 'collection' ? collectionFilter(mode.c) : mode.kind === 'block' ? mode.f : {};
  const q = (query.q ?? '').slice(0, 60) || undefined;
  const game = fixed.game ?? (GAMES.find((g) => g.id === query.hra)?.id as GameId | undefined);
  const sort = (COLLECTION_SORTS.find((s) => s.id === query.razeni)?.id ?? fixed.sort ?? 'new') as CollectionSort;
  const n = Number(query.strana);
  const page = Number.isInteger(n) && n > 1 ? n : 1;
  const { items, total } = await searchShopListings(p.seller.id, {
    ...fixed, q: [fixed.q, q].filter(Boolean).join(' ') || undefined, game, sort, page, pageSize: STOCK_PAGE,
  });

  const pages = Math.ceil(total / STOCK_PAGE);
  const view: Record<string, string> = mode.kind === 'collection' ? { kolekce: mode.c.id } : mode.kind === 'block' ? { blok: mode.b.id } : { zalozka: 'nabidka' };
  const href = (params: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...view, ...params })) if (v) sp.set(k, v);
    return `${base}?${sp.toString()}`;
  };
  const keep = { q: query.q, hra: query.hra, razeni: query.razeni };
  const counts = fixed.game || fixed.ids ? [] : await getGameCounts(p.seller.id);
  const title = mode.kind === 'collection' ? mode.c.name : mode.kind === 'block' ? blockTitle(mode.b) : 'Celá nabídka';

  return (
    <ShopSection id="nabidka" title={title} note={plural(total, ['karta', 'karty', 'karet'])}>
      {mode.kind !== 'all' ? <p className="t-small" style={{ margin: 0 }}><Link href={base}>← Zpět na přehled</Link></p> : null}
      {mode.kind === 'collection' && mode.c.desc ? <p className="muted" style={{ margin: 0 }}>{mode.c.desc}</p> : null}
      <form action={base} className={styles.stockBar} role="search">
        {Object.entries(view).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {query.hra ? <input type="hidden" name="hra" value={query.hra} /> : null}
        {query.razeni ? <input type="hidden" name="razeni" value={query.razeni} /> : null}
        <div className={styles.stockSearch}>
          <input type="search" name="q" defaultValue={query.q ?? ''} placeholder={`Hledat v nabídce prodejce ${p.seller.name}`} aria-label="Hledat v nabídce prodejce" />
          <button type="submit" className="tz-btn tz-btn-secondary tz-btn-md">Hledat</button>
        </div>
      </form>
      <div className={styles.stockBar}>
        {counts.length > 1 ? (
          <>
            <ChipLink href={href({ q: query.q, razeni: query.razeni })} selected={!query.hra}>Vše</ChipLink>
            {GAMES.filter((g) => counts.some((c) => c.game === g.id)).map((g) => (
              <ChipLink key={g.id} href={href({ ...keep, hra: g.id, strana: undefined })} selected={query.hra === g.id} dot={g.dot}>{g.name}</ChipLink>
            ))}
            <span className={styles.barSpacer} />
          </>
        ) : null}
        {COLLECTION_SORTS.map((s) => (
          <ChipLink key={s.id} href={href({ ...keep, razeni: s.id, strana: undefined })} selected={sort === s.id}>{s.name}</ChipLink>
        ))}
      </div>
      {items.length ? (
        <>
          <div className={styles.grid}>{items.map((l) => <ListingTile key={l.id} l={l} d={d} p={p} />)}</div>
          {pages > 1 ? (
            <nav className={styles.pager} aria-label="Stránky">
              {page > 1 ? <ChipLink href={href({ ...keep, strana: String(page - 1) })}>← Předchozí</ChipLink> : null}
              <span className="t-small muted">Strana {page} z {formatNumber(pages)}</span>
              {page < pages ? <ChipLink href={href({ ...keep, strana: String(page + 1) })}>Další →</ChipLink> : null}
            </nav>
          ) : null}
        </>
      ) : (
        <div className="panel"><p className="muted">{q || query.hra ? 'Nic neodpovídá hledání.' : mode.kind === 'all' ? 'Prodejce teď nic nenabízí.' : 'V tomhle výběru teď nic není.'}</p></div>
      )}
    </ShopSection>
  );
}

function contactHref(kind: string, v: string): string | null {
  if (kind === 'email') return `mailto:${v}`;
  if (kind === 'phone') return `tel:${v.replace(/\s/g, '')}`;
  if (kind === 'instagram') return `https://instagram.com/${v.replace(/^@/, '')}`;
  return /^https?:\/\//.test(v) ? v : /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(v) ? `https://${v}` : null;
}

const CONTACT_LABELS: Record<string, string> = { web: 'Web', instagram: 'Instagram', facebook: 'Facebook', discord: 'Discord', email: 'E-mail', phone: 'Telefon' };

type AboutPart = 'about' | 'contact' | 'store';
const PANEL_HEADING = { fontFamily: 'var(--shop-font)', textTransform: 'var(--shop-case)' as never };

/** Části O nás vždy v pořadí, v jakém přijdou (O nás, kontakt, prodejna); prázdné vynechá. */
function AboutPanels({ p, parts }: { p: ShopProfile; parts: AboutPart[] }) {
  const c = p.config;
  const contacts = Object.entries(c.contact).filter(([, v]) => v);
  return parts.map((part) => {
    if (part === 'about') {
      return c.about ? (
        <section key={part} className={styles.panel}>
          <h2 className="t-heading-m" style={PANEL_HEADING}>O nás</h2>
          <p className={styles.about}>{c.about}</p>
        </section>
      ) : null;
    }
    if (part === 'contact') {
      return contacts.length ? (
        <section key={part} className={styles.panel}>
          <h2 className="t-heading-m" style={PANEL_HEADING}>Kontakt</h2>
          {contacts.map(([k, v]) => {
            const href = contactHref(k, v);
            return (
              <p key={k} style={{ margin: 0 }}>
                <span className="t-small muted">{CONTACT_LABELS[k]}: </span>
                {href ? <a href={href} rel="nofollow noopener noreferrer" target={k === 'email' || k === 'phone' ? undefined : '_blank'}>{v}</a> : v}
              </p>
            );
          })}
        </section>
      ) : null;
    }
    return c.store.address || c.store.hours.length ? (
      <section key={part} className={styles.panel}>
        <h2 className="t-heading-m" style={PANEL_HEADING}>Kamenná prodejna</h2>
        {c.store.address ? <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{c.store.address}</p> : null}
        {c.store.pickup ? <p className="t-small muted" style={{ margin: 0 }}>Osobní odběr objednávek v prodejně</p> : null}
        {c.store.hours.length ? (
          <div className={styles.hours}>
            {c.store.hours.map((h, i) => <div key={i}><span className="muted">{h.day}</span><span className="t-price" style={{ fontSize: 13 }}>{h.time}</span></div>)}
          </div>
        ) : null}
      </section>
    ) : null;
  });
}

function hasAboutPart(p: ShopProfile, parts: AboutPart[]): boolean {
  const c = p.config;
  return parts.some((x) => (x === 'about' ? !!c.about : x === 'contact' ? Object.values(c.contact).some(Boolean) : !!(c.store.address || c.store.hours.length)));
}

/** Postranní panel Přehledu: O nás, kontakt, prodejna. */
function Sidebar({ p }: { p: ShopProfile }) {
  const parts: AboutPart[] = ['about', 'contact', 'store'];
  if (!hasAboutPart(p, parts)) return null;
  return <aside className={styles.aside}><AboutPanels p={p} parts={parts} /></aside>;
}

/** Záložka O nás: s panelem jsou kontakt a prodejna v něm (vlevo/vpravo jako na Přehledu), bez panelu vše pod sebou. */
function AboutView({ p }: { p: ShopProfile }) {
  const side = p.config.design.sidebar;
  const about = p.config.about ? <AboutPanels p={p} parts={['about']} /> : (
    <section className={styles.panel}>
      <h2 className="t-heading-m" style={PANEL_HEADING}>O nás</h2>
      <p className="muted" style={{ margin: 0 }}>Prodejce o sobě zatím nic nenapsal.</p>
    </section>
  );
  if (side === 'none') return <div className={styles.aboutStack}>{about}<AboutPanels p={p} parts={['contact', 'store']} /></div>;
  const rest = hasAboutPart(p, ['contact', 'store']);
  return (
    <div className={styles.columns} data-sidebar={side}>
      <div className={styles.main}>{about}</div>
      {rest ? <div className={styles.asideWrap}><aside className={styles.aside}><AboutPanels p={p} parts={['contact', 'store']} /></aside></div> : null}
    </div>
  );
}

/** Mezera mezi bloky, kde smí být oddělovač: aspoň jeden ze sousedů je přes celou šířku. Výchozí = oba. */
function dividerSlot(blocks: ShopBlock[], i: number, d: ShopDesign): { allowed: boolean; on: boolean } {
  const prev = blocks[i - 1];
  const b = blocks[i];
  if (!prev || d.divider === 'none') return { allowed: false, on: false };
  const allowed = prev.width === 'full' || b.width === 'full';
  const on = allowed && (d.dividerAt[b.id] ?? (prev.width === 'full' && b.width === 'full'));
  return { allowed, on };
}

/** Proč se blok v náhledu editoru neukazuje (jen pro majitele) */
function emptyHint(b: ShopBlock): string {
  const info = blockInfo(b.type);
  const until = b.data.notice?.until;
  if (b.type === 'notice' && until && until < new Date().toISOString().slice(0, 10)) {
    return `${info?.emoji} Oznámení platilo do ${until.split('-').reverse().map(Number).join('. ')}, proto se už neukazuje. Změňte datum Platí do.`;
  }
  return `${info?.emoji ?? ''} ${info?.name ?? 'Blok'}: zatím se neukáže, klikněte a doplňte obsah.`;
}

/**
 * Bloky přehledu: mřížka, ve které mohou bloky Pro stát vedle sebe.
 * Oddělovač patří do bloku přes celou šířku (nahoru, nebo dolů u předchozího), aby se při přetahování stěhoval s ním.
 */
async function Blocks({ p, base, edit }: { p: ShopProfile; base: string; edit?: boolean }) {
  const d = p.config.design;
  // Blok bez obsahu se veřejně vůbec nevykreslí (ani s oddělovačem); v editoru ukáže, proč chybí.
  const rendered = await Promise.all(p.config.blocks.map(async (b) => ({ b, node: await Block({ b, p, base }) })));
  const shown = edit ? rendered : rendered.filter((x) => x.node);
  const blocks = shown.map((x) => x.b);
  const slots = blocks.map((_, i) => dividerSlot(blocks, i, d));
  const gap = (i: number, at: 'top' | 'bottom') => {
    const slot = slots[i];
    if (!slot?.allowed || (!slot.on && !edit)) return null;
    return (
      <div key={`g-${at}`} className={`tz-shop-gap ${edit ? styles.gap : ''}`} data-at={at} data-on={slot.on || undefined}>
        {slot.on ? <ShopDivider style={d.divider} /> : null}
        {edit ? (
          <button type="button" className={styles.gapToggle} data-gap={blocks[i].id} data-on={slot.on ? '1' : '0'}>
            {slot.on ? '× Odebrat oddělovač' : '+ Přidat oddělovač'}
          </button>
        ) : null}
      </div>
    );
  };
  return (
    <div className="tz-shop-blocks" data-order={edit ? blocks.map((b) => b.id).join(',') : undefined}>
      {blocks.map((b, i) => {
        const next = blocks[i + 1];
        return (
          <div
            key={b.id}
            data-w={b.width !== 'full' ? b.width : undefined}
            data-edit={edit ? `block:${b.id}` : undefined}
            data-block-id={edit ? b.id : undefined}
            className={edit ? styles.editable : undefined}
          >
            {b.width === 'full' ? gap(i, 'top') : null}
            <div className={edit ? styles.blockBody : undefined} data-empty={edit ? emptyHint(b) : undefined}>
              {shown[i].node}
            </div>
            {b.width === 'full' && next && next.width !== 'full' ? gap(i + 1, 'bottom') : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Celá vlastní stránka obchodu nebo sběratele (tarify Plus a Pro).
 * preview = majitel si prohlíží svou stránku, edit = náhled uvnitř editoru (klik na část otevře její nastavení, bloky jde přetahovat).
 */
export async function ShopPageView({ p, query, preview, edit, baseOverride }: { p: ShopProfile; query: StockQuery; preview?: boolean; edit?: boolean; baseOverride?: string }) {
  const c = p.config;
  const d = c.design;
  const base = baseOverride ?? shopHref(p.seller.kind, c.slug);
  const { total } = await searchShopListings(p.seller.id, { pageSize: 1 });
  const fontUrl = FONT_URLS[d.font];
  const tabs = visibleTabs(c);
  const collection = c.collections.find((col) => col.id === query.kolekce);
  const block = c.blocks.find((b) => b.id === query.blok);
  const blockF = block ? blockFilter(block) : null;
  const view = collection ? 'collection'
    : block && blockF ? 'block'
    : query.zalozka === 'onas' ? 'about'
    : query.zalozka === 'nabidka' || query.q || query.hra ? 'stock'
    : 'overview';
  const tabLinks = [
    { label: 'Přehled', href: base, current: view === 'overview' || view === 'block' },
    ...tabs.map((t) => ({
      label: t.label,
      href: t.id === 'nabidka' ? `${base}?zalozka=nabidka` : t.id === 'onas' ? `${base}?zalozka=onas` : `${base}?kolekce=${t.id.slice(2)}`,
      current: t.id === 'nabidka' ? view === 'stock' : t.id === 'onas' ? view === 'about' : view === 'collection' && t.id === `c:${collection?.id}`,
    })),
  ];
  const sticky = d.stickyTabs && tabLinks.length > 1;
  const sidebar = d.sidebar !== 'none' ? <Sidebar p={p} /> : null;
  const style = shopStyle(safeColor(d.color), d.color2 ? safeColor(d.color2) : '');

  return (
    <div
      className={`tz-shop tz-shop-bg ${styles.wrap}`}
      data-font={d.font}
      data-corners={d.corners}
      data-bg={d.background !== 'none' ? d.background : undefined}
      data-icon={d.icon !== 'bar' ? d.icon : undefined}
      data-theme={d.mode === 'light' ? 'light' : undefined}
      style={style}
    >
      {fontUrl ? <link rel="stylesheet" href={fontUrl} precedence="default" /> : null}
      {d.holo ? <HoloEffect /> : null}
      {sticky ? <SiteHeaderHeight /> : null}
      {edit ? <PreviewBridge sideDrop={PLANS[p.plan].fullDesign} /> : null}
      <div className={`container ${styles.page}`}>
        {preview && !edit ? (
          <div className={styles.notice} role="status">
            <span>Náhled: stránka {c.published ? 'je zveřejněná' : 'zatím není zveřejněná, vidíte ji jen vy'}. Tarif {PLANS[p.plan].name}.</span>
            <Link href="/ucet/stranka">Upravit stránku</Link>
          </div>
        ) : null}
        {d.ticker ? (
          <div data-edit={edit ? 'header' : undefined} className={edit ? styles.editable : undefined}>
            <ShopTicker message={d.ticker} />
          </div>
        ) : null}
        <div data-edit={edit ? 'header' : undefined} className={edit ? styles.editable : undefined}>
          <ShopHeader
            layout={d.layout}
            name={p.seller.name}
            logo={mediaImage(c.logoPath, 256)}
            logoRound={d.logo === 'round'}
            bannerImage={d.banner === 'photo' ? mediaImage(c.bannerPath, 1920) : null}
            bannerStyle={d.banner === 'photo' ? 'solid' : d.banner}
            bannerLive={d.liveBanner}
            meta={sellerMeta(p, total)}
            tagline={c.tagline || undefined}
            badges={<>{p.badge ? <SellerBadge type="verified" /> : null}{p.plan === 'pro' ? <SellerBadge type="pro" /> : null}</>}
            extra={p.achievements.length ? <Achievements items={p.achievements} /> : undefined}
            actions={<MessageSeller sellerId={p.seller.id} />}
            tabs={sticky ? undefined : tabLinks}
          />
        </div>
        {sticky ? (
          <nav className="tz-shop-tabs tz-shop-tabs-sticky" aria-label="Části stránky">
            {tabLinks.map((t) => <a key={t.href + t.label} href={t.href} aria-current={t.current ? 'page' : undefined}>{t.label}</a>)}
          </nav>
        ) : null}
        {view === 'overview' ? (
          <div className={styles.columns} data-sidebar={d.sidebar}>
            <div className={styles.main}>
              {c.blocks.length ? <Blocks p={p} base={base} edit={edit} /> : null}
            </div>
            {sidebar ? <div data-edit={edit ? 'about' : undefined} className={`${styles.asideWrap} ${edit ? styles.editable : ''}`}>{sidebar}</div> : null}
          </div>
        ) : view === 'about' ? (
          <AboutView p={p} />
        ) : view === 'collection' && collection ? (
          <Stock p={p} base={base} query={query} mode={{ kind: 'collection', c: collection }} />
        ) : view === 'block' && block && blockF ? (
          <Stock p={p} base={base} query={query} mode={{ kind: 'block', b: block, f: blockF }} />
        ) : (
          <Stock p={p} base={base} query={query} mode={{ kind: 'all' }} />
        )}
      </div>
    </div>
  );
}

/** Předvyplněná zpráva k nabídce karty z bloku Hledám. */
function offerText(c: { name: string; setCode: string; number: string }, maxPrice?: number | null): string {
  const price = maxPrice ? ` za ${formatNumber(maxPrice)} Kč` : '';
  return `Dobrý den, mám kartu ${c.name} (${c.setCode} ${c.number}), kterou hledáte. Nabízím ji${price}. Stav: , jazyk: .`;
}
