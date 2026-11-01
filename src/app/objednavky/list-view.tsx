import Link from 'next/link';
import { Status } from '@/components/trezor';
import { Ava } from '@/components/orders/Ava';
import { ExpiryStatus } from '@/components/orders/Expiry';
import { ViewToggle } from '@/components/orders/ViewToggle';
import { methodName } from '@/lib/delivery';
import { formatNumber, plural } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { orderLabel } from '@/lib/order-flow';
import { orderTask, SUBS, unpaidDays, type Bucket, type Role } from '@/lib/order-tasks';
import { flowOf, type OrderRow } from './parts';
import styles from './orders.module.css';


export interface OfferRow {
  id: string; buyer_id: string; seller_id: string; last_by: string; price_czk: number; quantity: number; expires_at: string; created_at: string;
  listings: { cards: CardRef | CardRef[] | null } | Array<{ cards: CardRef | CardRef[] | null }> | null;
}
type CardRef = { name: string; image_url: string | null; game_id: string | null };

export type ListParams = { nova?: string; tab?: string; stav?: string; ukol?: string; q?: string; n?: string };

/** Jeden řádek seznamu: objednávka nebo návrh ceny (DS Orders › Seznam). */
interface Row {
  key: string;
  href: string;
  thumbs: Array<{ img?: string; color?: string }>;
  title: string;
  more: string;
  code: string;
  otherId: string | null;
  otherName: string;
  meta: string;
  state: React.ReactNode;
  next: string;
  go: boolean;
  price: number;
  bucket: Bucket;
  task: string;
  /** Čím dřív, tím výš (ms). */
  sort: number;
  search: string;
}

const STAV: Bucket[] = ['ja', 'druha', 'hotove', 'zrusene'];
const PAGE = 25;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const short = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', timeZone: 'Europe/Prague' });
};
const moreText = (n: number) => (n <= 0 ? '' : n === 1 ? 'a 1 další' : n <= 4 ? `a ${n} další` : `a ${n} dalších`);

/** Seznam objednávek (DS Orders › Seznam); data načte stránka. */
export function OrdersListView({ uid, all, offers, names, sp }: { uid: string; all: OrderRow[]; offers: OfferRow[]; names: Map<string, string>; sp: ListParams }) {
  const now = Date.now();

  const orderRow = (o: OrderRow, role: Role): Row => {
    const f = flowOf(o);
    const t = orderTask({ ...f, decidedAt: o.decided_at, createdAt: o.created_at }, role, now);
    const otherId = role === 'buyer' ? o.seller_id : o.buyer_id;
    const otherName = (otherId && names.get(otherId)) || 'smazaný účet';
    const label = orderLabel(f, role);
    const items = o.order_items;
    const first = items[0]?.cards;
    const ship = o.delivery === 'pickup' ? 'Osobní předání' : `${o.payment === 'cod' ? 'Dobírka ' : ''}${o.carrier ? methodName({ carrier: o.carrier, label: o.carrier_label }) : 'Doprava'}`;
    const late = t.task === 'nezaplaceno';
    const state = o.status === 'requested' && o.expires_at && o.ship_change_czk == null
      ? <ExpiryStatus expiresAt={o.expires_at} role={role} />
      : late
        ? <Status tone="warn">Nezaplaceno {plural(unpaidDays({ decidedAt: o.decided_at, createdAt: o.created_at }, now), ['den', 'dny', 'dní'])}</Status>
        : <Status tone={label.tone}>{label.text}</Status>;
    // Návrhy a čekající potvrzení podle termínu, ostatní od nejstarší; hotové a zrušené od nejnovější.
    const sort = t.bucket === 'hotove' || t.bucket === 'zrusene'
      ? -Date.parse(o.created_at)
      : o.status === 'requested' && o.expires_at ? Date.parse(o.expires_at) - 1e13 : Date.parse(o.decided_at ?? o.created_at);
    return {
      key: o.id,
      href: `/objednavky/${o.number}`,
      thumbs: items.slice(0, 3).map((i) => ({ img: thumbUrl(i.cards?.image_url ?? undefined), color: i.cards?.game_id ? `var(--game-${i.cards.game_id}-art)` : undefined })),
      title: first?.name ?? 'Karta',
      more: moreText(items.length - 1),
      code: `č. ${o.number}`,
      otherId,
      otherName,
      meta: `${short(o.created_at)} · ${ship}`,
      state,
      next: t.bucket === 'hotove' ? `Dokončeno${o.delivered_at ? ` ${short(o.delivered_at)}` : ''}` : t.bucket === 'zrusene' ? (o.decline_reason ? `„${o.decline_reason}“` : '') : t.next,
      go: t.bucket === 'ja',
      price: o.total_czk,
      bucket: t.bucket,
      task: t.task,
      sort,
      search: [o.number, otherName, ...items.map((i) => i.cards?.name ?? '')].join(' ').toLowerCase(),
    };
  };

  const offerRow = (o: OfferRow): Row & { role: Role } => {
    const role: Role = o.buyer_id === uid ? 'buyer' : 'seller';
    const otherId = role === 'buyer' ? o.seller_id : o.buyer_id;
    const otherName = names.get(otherId) ?? 'smazaný účet';
    const card = one(one(o.listings)?.cards);
    const myTurn = o.last_by !== uid;
    return {
      role,
      key: o.id,
      href: `/objednavky/navrh/${o.id}`,
      thumbs: [{ img: thumbUrl(card?.image_url ?? undefined), color: card?.game_id ? `var(--game-${card.game_id}-art)` : undefined }],
      title: `Návrh ceny: ${card?.name ?? 'Karta'}`,
      more: o.quantity > 1 ? `${o.quantity} ks` : '',
      code: 'návrh',
      otherId,
      otherName,
      meta: short(o.created_at),
      state: <ExpiryStatus expiresAt={o.expires_at} role={myTurn ? 'seller' : 'buyer'} label={myTurn ? 'Návrh ceny' : 'Čeká na odpověď'} act="Odpovězte do" />,
      next: myTurn ? 'Přijměte, odmítněte, nebo pošlete protinávrh.' : `${otherName} odpoví na váš návrh.`,
      go: myTurn,
      price: o.price_czk,
      bucket: myTurn ? 'ja' : 'druha',
      task: myTurn ? 'navrhy' : '',
      sort: Date.parse(o.expires_at) - 2e13,
      search: [otherName, card?.name ?? '', 'návrh'].join(' ').toLowerCase(),
    };
  };

  const byRole: Record<Role, Row[]> = {
    buyer: all.filter((o) => o.buyer_id === uid).map((o) => orderRow(o, 'buyer')),
    seller: all.filter((o) => o.seller_id === uid).map((o) => orderRow(o, 'seller')),
  };
  for (const o of offers) {
    const r = offerRow(o);
    byRole[r.role].push(r);
  }
  const count = (role: Role, b: Bucket) => byRole[role].filter((r) => r.bucket === b).length;

  // Výchozí záložka: kde na mě něco čeká; prodejce bez nákupů rovnou na Prodejích.
  const tab: Role = sp.tab === 'prodeje' ? 'seller' : sp.tab === 'nakupy' ? 'buyer'
    : (count('seller', 'ja') && !count('buyer', 'ja')) || (!byRole.buyer.length && byRole.seller.length) ? 'seller' : 'buyer';
  const rows = byRole[tab];
  const stav: Bucket = STAV.includes(sp.stav as Bucket) ? (sp.stav as Bucket)
    : count(tab, 'ja') ? 'ja' : count(tab, 'druha') ? 'druha' : count(tab, 'hotove') ? 'hotove' : 'ja';
  const inBucket = rows.filter((r) => r.bucket === stav);
  const subs = stav === 'ja' || stav === 'druha' ? SUBS[tab][stav].filter(([k]) => k !== 'predat' || inBucket.some((r) => r.task === 'predat')) : [];
  const ukol = subs.some(([k]) => k === sp.ukol) ? sp.ukol! : '';
  const q = (sp.q ?? '').trim().toLowerCase();
  const shown = inBucket
    .filter((r) => !ukol || r.task === ukol)
    .filter((r) => !q || r.search.includes(q))
    .sort((a, b) => a.sort - b.sort);
  const limit = Math.max(PAGE, Math.min(1000, Number(sp.n) || PAGE));
  const page = shown.slice(0, limit);

  const tabKey = tab === 'buyer' ? 'nakupy' : 'prodeje';
  const href = (p: { tab?: string; stav?: string; ukol?: string; n?: number }) => {
    const s = new URLSearchParams({ tab: p.tab ?? tabKey });
    if (p.stav ?? (p.tab ? undefined : stav)) s.set('stav', p.stav ?? stav);
    if (p.ukol) s.set('ukol', p.ukol);
    if (q && !p.tab) s.set('q', sp.q!.trim());
    if (p.n) s.set('n', String(p.n));
    return `/objednavky?${s}`;
  };
  const tabCount = (role: Role) => {
    const hot = count(role, 'ja');
    const active = hot + count(role, 'druha');
    return active ? <span className="tz-ord-n" data-hot={hot ? '' : undefined}>{hot || active}</span> : null;
  };

  // Posledních 30 dní u prodejů (Šimon 1. 11.).
  const since = now - 30 * 86400_000;
  const recent = all.filter((o) => o.seller_id === uid && !['cancelled', 'declined', 'expired'].includes(o.status) && Date.parse(o.created_at) >= since);
  const recentSum = recent.reduce((s, o) => s + o.total_czk, 0);

  const other = tab === 'buyer' ? 'prodejce' : 'kupujícího';
  const empty = q ? 'Nic nenalezeno.' : stav === 'ja' ? 'Nic na vás nečeká.' : stav === 'druha' ? `Nic nečeká na ${other}.` : stav === 'hotove' ? 'Zatím žádné dokončené objednávky.' : 'Žádné zrušené objednávky.';

  return (
    <div className={`container ${styles.list}`}>
      <div className="tz-ord-top">
        <h1 className="t-heading-l">Objednávky</h1>
        {tab === 'seller' && recent.length ? (
          <span className="tz-ord-sum30">Posledních 30 dní: <b>{formatNumber(recent.length)}</b> {plural(recent.length, ['prodej', 'prodeje', 'prodejů']).replace(/^[\d\s ]+/, '')} · <b>{formatNumber(recentSum)} Kč</b></span>
        ) : null}
      </div>
      {sp.nova ? (
        <p className={styles.ok} role="status">
          Objednávka je odeslaná. Prodejce ji do 48 hodin potvrdí a přijde vám e-mail. Pak se s ním domluvíte na platbě a předání.
        </p>
      ) : null}

      <nav className="tz-ord-tabs" aria-label="Nákupy nebo prodeje">
        <Link href="/objednavky?tab=nakupy" aria-current={tab === 'buyer' ? 'page' : undefined}>Nákupy{tabCount('buyer')}</Link>
        <Link href="/objednavky?tab=prodeje" aria-current={tab === 'seller' ? 'page' : undefined}>Prodeje{tabCount('seller')}</Link>
      </nav>

      <div className="tz-ord-bar">
        {STAV.map((b) => {
          const n = count(tab, b);
          const name = b === 'ja' ? 'Čeká na mě' : b === 'druha' ? `Čeká na ${other}` : b === 'hotove' ? 'Dokončené' : 'Zrušené';
          return (
            <Link key={b} href={href({ stav: b })} className="tz-ord-chip" aria-current={stav === b ? 'true' : undefined}>
              {name}
              {b === 'ja' ? (n ? <span className="tz-ord-n" data-hot="">{n}</span> : null) : <span className="k">{formatNumber(n)}</span>}
            </Link>
          );
        })}
        <form className="tz-ord-search" action="/objednavky" role="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input type="hidden" name="tab" value={tabKey} />
          <input type="hidden" name="stav" value={stav} />
          <input name="q" defaultValue={sp.q ?? ''} placeholder={`Číslo, karta nebo ${tab === 'buyer' ? 'prodejce' : 'kupující'}`} aria-label="Hledat v objednávkách" />
        </form>
      </div>

      {/* Úkoly jako tenký řádek textu, vybraný podtržený mátově, nuly zůstávají (Šimon 1. 11.). */}
      <nav className="tz-ord-sub" aria-label="Úkol">
        {subs.length ? (
          <>
            <Link href={href({})} aria-current={!ukol ? 'true' : undefined}>Vše<i>{inBucket.length}</i></Link>
            {subs.map(([k, name]) => {
              const n = inBucket.filter((r) => r.task === k).length;
              return <Link key={k} href={href({ ukol: k })} aria-current={ukol === k ? 'true' : undefined} data-zero={n ? undefined : ''}>{name}<i>{n}</i></Link>;
            })}
          </>
        ) : null}
        <ViewToggle target="ord-list" />
      </nav>

      <div className="tz-ord-list" id="ord-list">
        {page.length ? page.map((r) => (
          <Link key={r.key} href={r.href} className="tz-ord-row">
            <div className="tz-ord-thumbs" aria-hidden="true">
              {r.thumbs.map((t, i) => t.img
                // eslint-disable-next-line @next/next/no-img-element
                ? <img key={i} src={t.img} alt="" loading="lazy" decoding="async" />
                : <span key={i} style={{ background: t.color ?? 'var(--surface-sunken)' }} />)}
            </div>
            <div className="tz-ord-main">
              <b>{r.title}{r.more ? <> <span>{r.more}</span></> : null}</b>
              <div className="tz-ord-meta">
                <span className="tz-ord-num">{r.code}</span>·<Ava id={r.otherId} name={r.otherName} />{r.otherName}<span>· {r.meta}</span>
              </div>
            </div>
            <div className="tz-ord-state">
              {r.state}
              {r.next ? <span className="tz-ord-next">{r.next}</span> : null}
            </div>
            <div className="tz-ord-price">{formatNumber(r.price)} Kč</div>
            <svg className="tz-ord-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </Link>
        )) : (
          <p className="tz-ord-empty">
            {empty}{' '}
            {!rows.length ? (tab === 'buyer' ? <Link href="/karty">Procházet karty</Link> : <Link href="/prodat">Vystavit kartu</Link>) : null}
          </p>
        )}
        {shown.length > 0 ? (
          <div className="tz-ord-pager">
            <span>{page.length < shown.length ? `1–${page.length} z ${formatNumber(shown.length)}` : plural(shown.length, ['objednávka', 'objednávky', 'objednávek'])}{stav === 'ja' || stav === 'druha' ? ' · seřazeno podle toho, co hoří nejdřív' : ''}</span>
            {page.length < shown.length ? <Link href={href({ ukol, n: limit + PAGE })} className="tz-btn tz-btn-secondary tz-btn-md" scroll={false}>Zobrazit dalších</Link> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
