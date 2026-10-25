import Link from 'next/link';
import { Achievements, ButtonLink, CardTag, ChipLink, Price, SellerBadge, ShopDivider, ShopHeader, ShopSection, ShopTicker, shopStyle } from '@/components/trezor';
import { CardSummaryTile } from '@/components/CardSummaryTile';
import { AddToCartButton } from '@/components/cart/AddToCartButton';
import { PAGE_SIZE, searchCards } from '@/lib/catalog';
import { formatNumber, plural } from '@/lib/format';
import { GAMES, getGame } from '@/lib/games';
import { PLANS } from '@/lib/plans';
import { blockInfo, safeColor, shopHref, visibleTabs, type ShopBlock, type ShopCollection, type ShopDesign } from '@/lib/shop-config';
import { getCardsByIds, getGameCounts, getShopListings, getShopReviews, mediaUrl, type ShopListing, type ShopProfile } from '@/lib/shop';
import { Countdown, HoloEffect, MapEmbed, PreviewBridge, SiteHeaderHeight, VideoEmbed } from './ShopClient';
import { CONDITION_NAMES, LANGUAGE_NAMES, type Condition, type Language } from '@/lib/types';
import type { GameId } from '@/lib/games';
import styles from './shop.module.css';

export interface StockQuery {
  /** Pohled: 'nabidka' (celá nabídka) nebo 'onas'; bez něj Přehled */
  zalozka?: string;
  q?: string;
  hra?: string;
  kolekce?: string;
  strana?: string;
}

const FONT_URLS: Record<string, string> = {
  classic: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap',
  sport: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&display=swap',
};

function sellerMeta(p: ShopProfile, offers: number) {
  const s = p.seller;
  return (
    <>
      {s.kind === 'shop' ? 'Obchod' : 'Sběratel'} · {s.country === 'SK' ? 'Slovensko' : 'Česko'} ·{' '}
      {s.rating != null ? <>{formatNumber(s.rating, 1)}&nbsp;% kladných z {plural(s.sales, ['hodnocení', 'hodnocení', 'hodnocení'])}</> : 'Zatím bez hodnocení'}
      {' · '}{plural(offers, ['karta v nabídce', 'karty v nabídce', 'karet v nabídce'])}
    </>
  );
}

function cartItem(l: ShopListing, p: ShopProfile) {
  return {
    listingId: l.id,
    cardSlug: l.card.slug,
    cardName: l.card.name,
    setLabel: `${l.card.setCode} ${l.card.number}`,
    sellerId: p.seller.id,
    sellerName: p.seller.name,
    condition: l.condition + (l.graded ? ` · ${l.graded}` : ''),
    language: LANGUAGE_NAMES[l.language] ?? l.language,
    price: l.price,
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
      <div className="tz-tile-frame">{getGame(game)?.label}</div>
    </div>
  );
}

const WEEK = 7 * 24 * 3600 * 1000;

/** Štítek nabídky: vlastní štítek obchodu, jinak automaticky Poslední kus nebo Novinka. */
function listingTag(l: ShopListing, d: ShopDesign) {
  if (d.customTag && d.customTagIds.includes(l.id)) return <CardTag kind="custom">{d.customTag}</CardTag>;
  if (!d.tagsAuto) return null;
  if (l.quantity === 1) return <CardTag kind="last">Poslední kus</CardTag>;
  if (Date.now() - new Date(l.createdAt).getTime() < WEEK) return <CardTag kind="new">Novinka</CardTag>;
  return null;
}

function ListingTile({ l, d }: { l: ShopListing; d: ShopDesign }) {
  return (
    <Link className="tz-tile" href={`/karty/${l.card.slug}`}>
      <Art image={l.card.image} game={l.card.game} name={l.card.name} holo={d.holo} tag={listingTag(l, d)} />
      <div>
        <div className="tz-tile-name">{l.card.name}</div>
        <div className="tz-tile-set">{l.card.setCode} {l.card.number}</div>
      </div>
      <div className="tz-tile-row">
        <Price amount={l.price} />
        <span className="code" title={CONDITION_NAMES[l.condition]}>{l.condition}{l.graded ? ` · ${l.graded}` : ''}</span>
      </div>
    </Link>
  );
}

function Listings({ items, variant, d }: { items: ShopListing[]; variant: string; d: ShopDesign }) {
  return (
    <div className={variant === 'strip' ? styles.strip : styles.grid}>
      {items.map((l) => <ListingTile key={l.id} l={l} d={d} />)}
    </div>
  );
}

function blockTitle(b: ShopBlock): string {
  return b.title || blockInfo(b.type)?.name || '';
}

async function Block({ b, p, base }: { b: ShopBlock; p: ShopProfile; base: string }) {
  const sid = p.seller.id;
  const d = p.config.design;
  switch (b.type) {
    case 'notice': {
      const n = b.data.notice;
      if (!n?.title && !n?.text) return null;
      if (n.until && n.until < new Date().toISOString().slice(0, 10)) return null;
      const until = n.until ? `PLATÍ DO ${n.until.split('-').reverse().map(Number).join('. ')}` : 'OZNÁMENÍ';
      if (b.variant === 'bar') {
        return (
          <section aria-label="Oznámení" className={`${styles.noticeBar} tz-shop-soft`}>
            <span className="t-label">{until}</span>
            <strong>{n.title}</strong>
            {n.text ? <span>{n.text}</span> : null}
          </section>
        );
      }
      return (
        <section aria-label="Oznámení" className={styles.noticeCard}>
          <span className={`${styles.noticeIcon} tz-shop-soft`} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" /><path d="M15 9a4 4 0 0 1 0 6" /><path d="M18 6a8 8 0 0 1 0 12" /></svg>
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span className="t-label muted">{until}</span>
            {n.title ? <p className="t-heading-m" style={{ margin: 0, fontFamily: 'var(--shop-font)' }}>{n.title}</p> : null}
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
              <Price amount={l.price} size="lg" />
              <AddToCartButton item={cartItem(l, p)} variant="primary" />
              <Link href={`/karty/${l.card.slug}`}>Detail karty</Link>
            </div>
          </div>
        </section>
      );
    }
    case 'featured': {
      const items = await getShopListings(sid, { ids: b.data.featured?.listingIds ?? [] });
      if (!items.length) return null;
      return <ShopSection title={blockTitle(b)} note="Vybírá prodejce"><Listings items={items} variant={b.variant} d={d} /></ShopSection>;
    }
    case 'newest': {
      const items = await getShopListings(sid, { order: 'new', limit: 12 });
      if (!items.length) return null;
      return <ShopSection title={blockTitle(b)} note="Poslední přidané nabídky"><Listings items={items} variant={b.variant} d={d} /></ShopSection>;
    }
    case 'cheap': {
      const max = b.data.cheap?.maxPrice ?? 100;
      const items = await getShopListings(sid, { order: 'cheap', maxPrice: max, limit: 12 });
      if (!items.length) return null;
      return <ShopSection title={blockTitle(b)} note={`Do ${formatNumber(max)} Kč`}><Listings items={items} variant={b.variant} d={d} /></ShopSection>;
    }
    case 'games': {
      const counts = await getGameCounts(sid);
      const picked = b.data.games?.games ?? [];
      const ordered = GAMES
        .filter((g) => !picked.length || picked.includes(g.id))
        .map((g) => ({ g, n: counts.find((c) => c.game === g.id)?.cards ?? 0 }))
        .filter((x) => x.n > 0);
      if (!ordered.length) return null;
      return (
        <ShopSection title={blockTitle(b)}>
          <div className={styles.tiles}>
            {ordered.map(({ g, n }) => (
              <Link key={g.id} href={`${base}?zalozka=nabidka&hra=${g.id}`} className={styles.tile}>
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
      if (!p.config.collections.length) return null;
      return (
        <ShopSection title={blockTitle(b)}>
          <div className={styles.tiles}>
            {p.config.collections.map((c) => (
              <Link key={c.id} href={`${base}?kolekce=${c.id}`} className={styles.tile}>
                <span className={styles.tileTitle}>{c.name}</span>
                <span className="t-small muted">{collectionLabel(c)}</span>
              </Link>
            ))}
          </div>
        </ShopSection>
      );
    }
    case 'events': {
      const items = (b.data.events ?? []).filter((e) => !e.date || e.date >= new Date().toISOString().slice(0, 10));
      if (!items.length) return null;
      return (
        <ShopSection title={blockTitle(b)}>
          <div className={styles.tiles}>
            {items.map((e, i) => {
              const [, m, d] = e.date ? e.date.split('-') : ['', '', ''];
              return (
                <div key={i} className={styles.event}>
                  {e.date ? (
                    <span className={`${styles.eventDate} tz-shop-soft`}>
                      <span className="t-price">{Number(d)}.</span>
                      <span className="t-label muted">{MONTHS[Number(m) - 1]}</span>
                    </span>
                  ) : null}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <strong>{e.title}</strong>
                    {e.info ? <span className="t-small muted">{e.info}</span> : null}
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
          <div className={styles.photos}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photos.map((ph) => <img key={ph} src={mediaUrl(ph)!} alt="" loading="lazy" />)}
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
          <div className={styles.grid}>
            {shown.map((x) => {
              const c = cards.get(x.cardId)!;
              return (
                <Link key={x.cardId} className="tz-tile" href={`/karty/${c.slug}`}>
                  <Art image={c.image} game={c.game} name={c.name} holo={d.holo} />
                  <div>
                    <div className="tz-tile-name">{c.name}</div>
                    <div className="tz-tile-set">{c.setCode} {c.number}</div>
                  </div>
                  {x.grade || x.note ? (
                    <div className="tz-tile-row">
                      {x.grade ? <span className="code">{x.grade}</span> : <span />}
                      {x.note ? <span className="t-small muted">{x.note}</span> : null}
                    </div>
                  ) : null}
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
      return (
        <section aria-label={blockTitle(b)} className="tz-shop-window" data-count={items.length >= 5 ? 5 : 3}>
          {items.slice(0, items.length >= 5 ? 5 : 3).map((l) => (
            <Link key={l.id} href={`/karty/${l.card.slug}`} className={`tz-shop-window-card ${d.holo ? 'tz-holo' : ''}`} title={`${l.card.name} · ${formatNumber(l.price)} Kč`}>
              {l.card.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={l.card.image} alt={l.card.name} />
                : <span className="tz-shop-window-art" style={{ background: `var(--game-${l.card.game}-art, var(--surface-sunken))` }} />}
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
          <Countdown at={c.at} />
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
                {m.photo ? <img className="tz-team-photo" src={mediaUrl(m.photo)!} alt="" /> : <span className="tz-team-photo" aria-hidden="true" />}
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
        <ShopSection title={blockTitle(b)} note="Máte některou? Napište prodejci">
          <div className={styles.wanted}>
            {shown.map((x) => {
              const c = cards.get(x.cardId)!;
              return (
                <Link key={x.cardId} href={`/karty/${c.slug}`} className={styles.wantedRow}>
                  <span className={styles.wantedText}>
                    <strong>{c.name}</strong>
                    <span className="code muted">{c.setCode} {c.number}</span>
                  </span>
                  {x.maxPrice ? <span className="t-price">do {formatNumber(x.maxPrice)} Kč</span> : null}
                </Link>
              );
            })}
          </div>
        </ShopSection>
      );
    }
  }
}

const MONTHS = ['LED', 'ÚNO', 'BŘE', 'DUB', 'KVĚ', 'ČVN', 'ČVC', 'SRP', 'ZÁŘ', 'ŘÍJ', 'LIS', 'PRO'];

export function collectionLabel(c: ShopCollection): string {
  return [
    c.game ? getGame(c.game)?.name : null,
    c.condition ? c.condition : null,
    c.language ? LANGUAGE_NAMES[c.language as Language] : null,
    c.q ? `„${c.q}“` : null,
  ].filter(Boolean).join(' · ') || 'Celý sklad';
}

/** Celá nabídka nebo kolekce s hledáním; na Přehledu jen náhled prvních karet. */
async function Stock({ p, base, query, preview }: { p: ShopProfile; base: string; query: StockQuery; preview?: boolean }) {
  const collection = preview ? undefined : p.config.collections.find((c) => c.id === query.kolekce);
  const q = preview ? undefined : (query.q ?? collection?.q ?? '').slice(0, 60) || undefined;
  const game = preview ? undefined : (GAMES.find((g) => g.id === query.hra)?.id ?? (collection?.game || undefined)) as GameId | undefined;
  const n = Number(query.strana);
  const page = !preview && Number.isInteger(n) && n > 1 ? n : 1;
  const { cards, total } = await searchCards({
    sellerId: p.seller.id, q, game, page,
    pageSize: preview ? 12 : PAGE_SIZE,
    condition: (collection?.condition || undefined) as Condition | undefined,
    language: (collection?.language || undefined) as Language | undefined,
  });

  if (preview) {
    if (!cards.length) return null;
    return (
      <ShopSection title="Z nabídky" note={plural(total, ['karta', 'karty', 'karet'])}>
        <div className="card-grid">{cards.map((c) => <CardSummaryTile key={c.id} card={c} />)}</div>
        {total > cards.length ? (
          <div className={styles.pager}>
            <ButtonLink href={`${base}?zalozka=nabidka`} variant="secondary">Zobrazit celou nabídku</ButtonLink>
          </div>
        ) : null}
      </ShopSection>
    );
  }

  const pages = Math.ceil(total / PAGE_SIZE);
  const view = collection ? { kolekce: collection.id } : { zalozka: 'nabidka' };
  const href = (params: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...view, ...params })) if (v) sp.set(k, v);
    return `${base}?${sp.toString()}`;
  };
  const keep = { q: query.q, hra: query.hra };
  const counts = await getGameCounts(p.seller.id);

  return (
    <ShopSection id="nabidka" title={collection ? collection.name : 'Celá nabídka'} note={plural(total, ['karta', 'karty', 'karet'])}>
      <form action={base} className={styles.stockBar} role="search">
        {collection ? <input type="hidden" name="kolekce" value={collection.id} /> : <input type="hidden" name="zalozka" value="nabidka" />}
        {query.hra ? <input type="hidden" name="hra" value={query.hra} /> : null}
        <div className={styles.stockSearch}>
          <input type="search" name="q" defaultValue={query.q ?? ''} placeholder={`Hledat v nabídce prodejce ${p.seller.name}`} aria-label="Hledat v nabídce prodejce" />
          <button type="submit" className="tz-btn tz-btn-secondary tz-btn-md">Hledat</button>
        </div>
      </form>
      {!collection?.game ? (
        <div className={styles.stockBar}>
          <ChipLink href={href({ q: query.q })} selected={!query.hra}>Vše</ChipLink>
          {GAMES.filter((g) => counts.some((c) => c.game === g.id)).map((g) => (
            <ChipLink key={g.id} href={href({ ...keep, hra: g.id })} selected={query.hra === g.id} dot={g.dot}>{g.name}</ChipLink>
          ))}
        </div>
      ) : null}
      {cards.length ? (
        <>
          <div className="card-grid">{cards.map((c) => <CardSummaryTile key={c.id} card={c} />)}</div>
          {pages > 1 ? (
            <nav className={styles.pager} aria-label="Stránky">
              {page > 1 ? <ChipLink href={href({ ...keep, strana: String(page - 1) })}>← Předchozí</ChipLink> : null}
              <span className="t-small muted">Strana {page} z {formatNumber(pages)}</span>
              {page < pages ? <ChipLink href={href({ ...keep, strana: String(page + 1) })}>Další →</ChipLink> : null}
            </nav>
          ) : null}
        </>
      ) : (
        <div className="panel"><p className="muted">{q || game ? 'Nic neodpovídá hledání.' : 'Prodejce teď nic nenabízí.'}</p></div>
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

function Sidebar({ p, wide }: { p: ShopProfile; wide?: boolean }) {
  const c = p.config;
  const contacts = Object.entries(c.contact).filter(([, v]) => v);
  if (!c.about && !c.store.address && !c.store.hours.length && !contacts.length) return null;
  return (
    <aside className={wide ? styles.aboutView : styles.aside}>
      {c.about ? (
        <section className={styles.panel}>
          <h2 className="t-heading-m" style={{ fontFamily: 'var(--shop-font)', textTransform: 'var(--shop-case)' as never }}>O nás</h2>
          <p className={styles.about}>{c.about}</p>
        </section>
      ) : null}
      {c.store.address || c.store.hours.length ? (
        <section className={styles.panel}>
          <h2 className="t-heading-m" style={{ fontFamily: 'var(--shop-font)', textTransform: 'var(--shop-case)' as never }}>Kamenná prodejna</h2>
          {c.store.address ? <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{c.store.address}</p> : null}
          {c.store.pickup ? <p className="t-small muted" style={{ margin: 0 }}>Osobní odběr objednávek v prodejně</p> : null}
          {c.store.hours.length ? (
            <div className={styles.hours}>
              {c.store.hours.map((h, i) => <div key={i}><span className="muted">{h.day}</span><span className="t-price" style={{ fontSize: 13 }}>{h.time}</span></div>)}
            </div>
          ) : null}
        </section>
      ) : null}
      {contacts.length ? (
        <section className={styles.panel}>
          <h2 className="t-heading-m" style={{ fontFamily: 'var(--shop-font)', textTransform: 'var(--shop-case)' as never }}>Kontakt</h2>
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
      ) : null}
    </aside>
  );
}

/** Bloky přehledu: mřížka, ve které mohou bloky Pro stát vedle sebe, s oddělovači mezi celými řádky. */
function Blocks({ p, base, edit }: { p: ShopProfile; base: string; edit?: boolean }) {
  const d = p.config.design;
  const blocks = p.config.blocks;
  return (
    <div className="tz-shop-blocks">
      {blocks.flatMap((b, i) => {
        const prev = blocks[i - 1];
        const out = [];
        if (d.divider !== 'none' && prev && prev.width === 'full' && b.width === 'full') {
          out.push(<ShopDivider key={`d-${b.id}`} style={d.divider} />);
        }
        out.push(
          <div key={b.id} data-w={b.width !== 'full' ? b.width : undefined} data-edit={edit ? `block:${b.id}` : undefined} className={edit ? styles.editable : undefined}>
            <Block b={b} p={p} base={base} />
          </div>,
        );
        return out;
      })}
    </div>
  );
}

/**
 * Celá vlastní stránka obchodu nebo sběratele (tarify Plus a Pro).
 * preview = majitel si prohlíží svou stránku, edit = náhled uvnitř editoru (klik na část otevře její nastavení).
 */
export async function ShopPageView({ p, query, preview, edit, baseOverride }: { p: ShopProfile; query: StockQuery; preview?: boolean; edit?: boolean; baseOverride?: string }) {
  const c = p.config;
  const d = c.design;
  const base = baseOverride ?? shopHref(p.seller.kind, c.slug);
  const { total } = await searchCards({ sellerId: p.seller.id, pageSize: 1 });
  const fontUrl = FONT_URLS[d.font];
  const tabs = visibleTabs(c);
  const collection = c.collections.find((col) => col.id === query.kolekce);
  const view = collection ? 'collection'
    : query.zalozka === 'onas' ? 'about'
    : query.zalozka === 'nabidka' || query.q || query.hra ? 'stock'
    : 'overview';
  const sep = base.includes('?') ? '&' : '?';
  const tabLinks = [
    { label: 'Přehled', href: base, current: view === 'overview' },
    ...tabs.map((t) => ({
      label: t.label,
      href: t.id === 'nabidka' ? `${base}${sep}zalozka=nabidka` : t.id === 'onas' ? `${base}${sep}zalozka=onas` : `${base}${sep}kolekce=${t.id.slice(2)}`,
      current: t.id === 'nabidka' ? view === 'stock' : t.id === 'onas' ? view === 'about' : view === 'collection' && t.id === `c:${collection?.id}`,
    })),
  ];
  const sticky = d.stickyTabs && tabLinks.length > 1;
  const sidebar = d.sidebar !== 'none' ? <Sidebar p={p} /> : null;
  const style = { ...shopStyle(safeColor(d.color)), ...(d.color2 ? { '--shop-2': `var(--shop-${safeColor(d.color2)})` } : {}) } as React.CSSProperties;

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
      {edit ? <PreviewBridge /> : null}
      <div className={`container ${styles.page}`}>
        {preview && !edit ? (
          <div className={styles.notice} role="status">
            <span>Náhled: stránka {c.published ? 'je zveřejněná' : 'zatím není zveřejněná, vidíte ji jen vy'}. Tarif {PLANS[p.plan].name}.</span>
            <Link href="/ucet/stranka">Upravit stránku</Link>
          </div>
        ) : null}
        {d.ticker.length ? (
          <div data-edit={edit ? 'header' : undefined} className={edit ? styles.editable : undefined}>
            <ShopTicker items={d.ticker} />
          </div>
        ) : null}
        <div data-edit={edit ? 'header' : undefined} className={edit ? styles.editable : undefined}>
          <ShopHeader
            layout={d.layout}
            name={p.seller.name}
            logo={mediaUrl(c.logoPath)}
            bannerImage={d.banner === 'photo' ? mediaUrl(c.bannerPath) : null}
            bannerStyle={d.banner === 'photo' ? 'pattern' : d.banner}
            bannerLive={d.liveBanner}
            season={d.season}
            meta={sellerMeta(p, total)}
            tagline={c.tagline || undefined}
            badges={<>{p.badge ? <SellerBadge type="verified" /> : null}{p.plan === 'pro' ? <SellerBadge type="pro" /> : null}</>}
            extra={p.achievements.length ? <Achievements items={p.achievements} /> : undefined}
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
              <div data-edit={edit ? 'tabs' : undefined}>
                <Stock p={p} base={base} query={query} preview />
              </div>
            </div>
            {sidebar ? <div data-edit={edit ? 'about' : undefined} className={`${styles.asideWrap} ${edit ? styles.editable : ''}`}>{sidebar}</div> : null}
          </div>
        ) : view === 'about' ? (
          <Sidebar p={p} wide />
        ) : (
          <Stock p={p} base={base} query={query} />
        )}
      </div>
    </div>
  );
}
