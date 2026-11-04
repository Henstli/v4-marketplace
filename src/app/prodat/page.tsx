import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { CardThumb } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { getAccountSummary } from '@/lib/account';
import { getCardBySlug } from '@/lib/catalog';
import { GAMES, getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatPrice, plural } from '@/lib/format';
import { loadReadiness, SellGate } from '@/components/delivery/SellGate';
import { ListingForm } from './ListingForm';
import { StockTable } from './StockTable';
import { StockActions } from './StockModals';
import { StockHistory, type HistoryEntry } from './StockHistory';
import { WantsView, type Want } from './Wants';
import { SetsView } from './SetsView';
import { loadStock, owned } from './data';
import { loadStrip } from './strip';
import { loadShipping } from './ship';
import { ShipManager } from './ShipManager';
import { InventoryViews, type InvView } from './InventoryViews';
import { loadInventory } from './inventory';
import { loadCtx, loadTeam, ROLE_NAMES, stockHref, type Perm, type StockCtx } from './team';
import { MarketViews } from './MarketViews';
import { Connections } from './Connections';
import { loadAuto, loadDemand, loadMarket, loadPrices, type MarketView } from './market';
import { nf } from './sk';
import styles from './sell.module.css';

export const metadata: Metadata = { title: 'Sklad' };

type Props = { searchParams: Promise<{
  zalozka?: string; karta?: string; hledat?: string; sada?: string; obchod?: string; pohled?: string; inventura?: string; tyden?: string; dni?: string;
}> };

type Tab = 'vse' | 'prodej' | 'odeslat' | 'trh' | 'inventura' | 'historie' | 'hledam' | 'sady' | 'napojeni';
const TABS: Tab[] = ['vse', 'prodej', 'odeslat', 'trh', 'inventura', 'historie', 'hledam', 'sady', 'napojeni'];
const SOLD = ['confirmed', 'pending_payment', 'paid', 'shipped', 'delivered'];
const VIEWS: InvView[] = ['mista', 'pocitani', 'kontrola', 'historie', 'plan', 'smeny'];

export default async function StockPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) {
    return <ComingSoon title="Sklad" text="Sklad zapneme po připojení databáze." />;
  }
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/prodat');

  const sp = await searchParams;
  const supabase = await createClient();
  // Vlastní sklad, nebo sklad obchodu, kde je přihlášený v týmu (?obchod=…).
  const ctx = await loadCtx(supabase, user, sp.obchod);
  const [account, ready, { data: restriction }] = await Promise.all([
    getAccountSummary(),
    ctx.isOwner ? loadReadiness(supabase, user.id) : Promise.resolve({ ready: true } as Awaited<ReturnType<typeof loadReadiness>>),
    supabase.from('account_restrictions').select('kind, until').eq('user_id', user.id).is('ended_at', null).maybeSingle(),
  ]);
  const shop = ctx.isOwner ? account?.kind === 'shop' : true;
  const has = (p: Perm) => ctx.perms.has(p);
  const href = (zalozka?: string, extra: Record<string, string> = {}) => stockHref(ctx, { zalozka, ...extra });

  // Prodat konkrétní kartu (odkaz z katalogu): samostatná stránka s formulářem nabídky.
  if (sp.karta && has('add')) {
    return (
      <div className="tz-sk"><div className="wrap">
        <Link className="btn sm g" href={href()} style={{ paddingLeft: 0 }}>← Zpět na {shop ? 'sklad' : 'sbírku'}</Link>
        <AddCard karta={sp.karta} ready={ready.ready} shop={shop} owner={ctx.isOwner ? undefined : ctx.owner}
          gate={ready.ready ? null : <SellGate r={ready} back="prodat" />} />
      </div></div>
    );
  }

  // Záložky přesně podle prototypu, jen ty, na které má přihlášený právo.
  const can: Record<Tab, boolean> = shop
    ? { vse: has('view'), prodej: has('price'), odeslat: has('ord'), trh: has('conn'), inventura: has('inv') || has('plan') || has('diff'), historie: has('conn'), hledam: false, sady: false, napojeni: has('conn') }
    : { vse: true, prodej: true, odeslat: false, trh: false, inventura: false, historie: true, hledam: true, sady: true, napojeni: true };
  const order: Tab[] = shop ? ['vse', 'prodej', 'odeslat', 'trh', 'inventura', 'historie'] : ['vse', 'prodej', 'hledam', 'sady', 'historie'];
  const tabs = order.filter((t) => can[t]);
  if (!tabs.length) {
    return (
      <div className="tz-sk"><div className="wrap">
        <div className="top"><h1>Sklad</h1></div>
        <p className="ilead">Vaše role zatím nemá přístup k žádné části skladu. Požádejte vedoucího o práva.</p>
      </div></div>
    );
  }
  let tab = (TABS.includes(sp.zalozka as Tab) ? sp.zalozka : 'vse') as Tab;
  if (!shop && tab === 'odeslat') redirect('/objednavky?tab=prodeje');
  if (!can[tab]) tab = tabs[0];

  const items = tab === 'vse' || tab === 'prodej' || can.vse ? await loadStock(supabase, ctx.owner) : [];
  const ship = tab === 'odeslat' ? await loadShipping(supabase, ctx.owner) : null;
  const [toShip, demandN, wantsN, team, auto, strip] = await Promise.all([
    ship ? ship.orders.filter((o) => o.ready).length : can.odeslat ? supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('seller_id', ctx.owner).or('status.eq.paid,and(status.eq.confirmed,payment.in.(cod,cash))').then((r) => r.count ?? 0) : 0,
    can.trh ? supabase.rpc('market_demand', { p_owner: ctx.owner }).then((r) => (r.data ?? []).length) : 0,
    shop ? 0 : supabase.from('stock_wants').select('card_id', { count: 'exact', head: true }).eq('user_id', user.id).then((r) => r.count ?? 0),
    shop && has('staff') ? loadTeam(supabase, ctx.owner) : null,
    shop && has('conn') ? loadAuto(supabase, ctx.owner) : null,
    tab === 'vse' || tab === 'prodej' ? loadStrip(supabase, ctx.owner, items, { watchers: shop && tab === 'prodej' }) : null,
  ]);
  const places = [...new Set(items.map((r) => r.location?.split(' · ')[0]).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'cs', { numeric: true }));
  const gameNames = GAMES.filter((g) => items.some((r) => r.card?.game === g.id)).map((g) => g.name);
  const kinds = (onSale: boolean) => new Set(items.filter((r) => owned(r) > 0 && (!onSale || r.quantity > 0)).map((r) => r.cardId)).size;
  const label: Record<Tab, string> = {
    vse: 'Všechny karty', prodej: 'Na prodej', odeslat: 'K odeslání', trh: 'Trh', inventura: 'Inventura', historie: 'Historie',
    hledam: 'Hledám', sady: 'Chybí do sad', napojeni: 'Napojení',
  };
  const count: Partial<Record<Tab, number>> = { vse: kinds(false), prodej: kinds(true), odeslat: toShip, trh: demandN, hledam: wantsN };
  const view = (VIEWS.includes(sp.pohled as InvView) ? sp.pohled : sp.inventura ? 'pocitani' : 'mista') as InvView;
  const title = shop ? 'Sklad' : 'Sbírka';

  const switcher = ctx.shops.length ? (
    <nav className="tz-stk-switch" aria-label="Čí sklad" style={{ marginBottom: 14 }}>
      <span className="t-small muted">Sklad:</span>
      <Link href="/prodat" aria-current={ctx.isOwner ? 'page' : undefined}>{account?.kind === 'shop' ? 'Můj obchod' : 'Moje sbírka'}</Link>
      {ctx.shops.map((s) => (
        <Link key={s.owner} href={`/prodat?obchod=${s.owner}`} aria-current={ctx.owner === s.owner ? 'page' : undefined}>
          {s.name}<small>{ROLE_NAMES[s.role] ?? ''}</small>
        </Link>
      ))}
    </nav>
  ) : null;

  if (tab === 'napojeni') {
    return (
      <div className="tz-sk"><div className="wrap">
        {switcher}
        <Connections back={href()} shop={shop} obchod={ctx.isOwner ? '' : ctx.owner} />
      </div></div>
    );
  }

  return (
    <div className="tz-sk"><div className="wrap">
      {switcher}
      <div className="top">
        <h1>{title}</h1>
        <StockActions shop={shop} owner={ctx.owner} ownerName={ctx.ownerName} me={user.id} meName={user.displayName} isOwner={ctx.isOwner}
          role={ctx.role} roleLabel={ROLE_NAMES[ctx.role] ?? ''} canStaff={has('staff')} canConn={has('conn')} canAdd={has('add')}
          napojeni={href('napojeni')} team={team} auto={auto} places={places} gameNames={gameNames} obchod={ctx.isOwner ? null : ctx.owner}
          total={items.filter((r) => owned(r) > 0).length} />
      </div>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <Link key={t} href={href(t === 'vse' ? undefined : t)} className={tab === t ? 'on' : ''} role="tab" aria-selected={tab === t}>
            {label[t]}{count[t] != null ? <span className="n">{nf(count[t]!)}</span> : null}
          </Link>
        ))}
      </div>

      {restriction && ctx.isOwner ? (
        <div className="attn"><i className="adot" /><span>
          <b>Vystavování máte omezené podporou V4cards{restriction.until ? ` do ${formatDate(restriction.until)}` : ''}.</b>{' '}
          Nabídky jsou skryté a nové nejde vystavit. Odůvodnění jsme vám poslali e-mailem, ohradit se můžete na{' '}
          <a href="mailto:podpora@v4cards.com" style={{ color: 'var(--accent)' }}>podpora@v4cards.com</a>.</span></div>
      ) : null}

      {(tab === 'vse' || tab === 'prodej') && strip ? (
        <>
          {ready.ready || !ctx.isOwner ? null : <SellGate r={ready} back="prodat" />}
          <StockTable key={tab} items={items} mode={tab === 'prodej' ? 'sale' : 'all'} shop={shop} ready={ready.ready}
            canPrice={has('price')} canAdd={has('add')} stats={strip} unmatched={0}
            napojeni={has('conn') ? href('napojeni') : null} ordersHref={shop && can.odeslat ? href('odeslat') : '/objednavky?tab=prodeje'}
            demandHref={can.trh ? href('trh') : null} />
        </>
      ) : null}
      {tab === 'odeslat' && ship ? <ShipManager orders={ship.orders} toConfirm={ctx.isOwner ? ship.toConfirm : 0} q={ctx.q} /> : null}
      {tab === 'historie' ? <History userId={ctx.owner} shop={shop} /> : null}
      {tab === 'inventura' ? (
        <InventoryViews data={await loadInventory(supabase, ctx.owner, user.id, ctx.ownerName, Math.max(-52, Math.min(52, Number(sp.tyden) || 0)))}
          view={view} invId={sp.inventura ? Number(sp.inventura) : undefined} owner={ctx.owner} me={user.id} perms={[...ctx.perms]} q={ctx.q}
          />
      ) : null}
      {tab === 'trh' ? <Market ctx={ctx} pohled={sp.pohled} dni={sp.dni} /> : null}
      {tab === 'hledam' ? <Wanted /> : null}
      {tab === 'sady' ? <Sets /> : null}
    </div></div>
  );
}

async function Market({ ctx, pohled, dni }: { ctx: StockCtx; pohled?: string; dni?: string }) {
  const supabase = await createClient();
  const view = (['poptavka', 'trh', 'ceny'].includes(pohled ?? '') ? pohled : 'poptavka') as MarketView;
  const days = dni === '30' ? 30 : 7;
  const [demand, market, prices, have] = await Promise.all([
    view === 'poptavka' ? loadDemand(supabase, ctx.owner) : undefined,
    view === 'trh' ? loadMarket(supabase, days) : undefined,
    view === 'ceny' ? loadPrices(supabase, ctx.owner) : undefined,
    view === 'trh' ? loadStock(supabase, ctx.owner).then((rows) => {
      const m: Record<string, number> = {};
      for (const r of rows) if (r.cardId) m[r.cardId] = (m[r.cardId] ?? 0) + owned(r);
      return m;
    }) : undefined,
  ]);
  return <MarketViews view={view} q={ctx.q} perms={[...ctx.perms]} owner={ctx.owner} days={days} demand={demand} market={market} prices={prices} have={have} />;
}

async function AddCard({ karta, ready, shop, gate, owner }: { karta: string; ready: boolean; shop: boolean; gate: React.ReactNode; owner?: string }) {
  const selected = await getCardBySlug(karta);
  if (!selected) return <p className="ilead" style={{ marginTop: 16 }}>Kartu jsme v katalogu nenašli.</p>;
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Přidat kartu do {shop ? 'skladu' : 'sbírky'}</h2>
      <div className={styles.picked}>
        <CardThumb size="lg" image={thumbUrl(selected.image)} preview={selected.image} color={`var(--game-${selected.game}-art)`} />
        <div className={styles.grow}>
          <p className="t-label muted">KARTA</p>
          <Link href={`/karty/${selected.slug}`} className={styles.rowName}>{selected.name}</Link>
          <div className="t-small muted">{selected.setName} · <span className="code">{selected.setCode} {selected.number}</span> · {getGame(selected.game)?.name}</div>
        </div>
      </div>
      {ready || owner ? null : gate}
      <ListingForm cardId={selected.id} ready={ready} shop={shop} owner={owner} />
    </section>
  );
}

async function History({ userId, shop }: { userId: string; shop: boolean }) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 365 * 86400000).toISOString();
  const [{ data: events }, { data: orders }, { data: invs }] = await Promise.all([
    supabase.from('stock_events').select('id, kind, title, detail, created_at, undo, sample, undone_at, actor_id')
      .eq('owner_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(500),
    supabase.from('orders').select('id, number, total_czk, status, created_at, decided_at, order_items(quantity)')
      .eq('seller_id', userId).in('status', SOLD).gte('created_at', since).order('created_at', { ascending: false }).limit(300),
    shop ? supabase.from('inventories').select('id, place, user_id, status, finished_at, lines')
      .eq('owner_id', userId).in('status', ['review', 'done']).gte('started_at', since).order('started_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const actors = [...new Set([...(events ?? []).map((e) => e.actor_id), ...(invs ?? []).map((i: { user_id: string | null }) => i.user_id)].filter(Boolean) as string[])];
  const { data: profs } = actors.length ? await supabase.from('profiles').select('id, display_name').in('id', actors) : { data: [] };
  const name = new Map(((profs ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  type Inv = { id: number; place: string; user_id: string | null; status: string; finished_at: string | null; lines: { expected: number; counted: number | null }[] };
  const entries: HistoryEntry[] = [
    ...(events ?? []).map((e) => ({
      key: `e${e.id}`, kind: e.kind as HistoryEntry['kind'], title: e.title, detail: e.detail, at: e.created_at,
      who: e.actor_id ? name.get(e.actor_id) ?? null : null,
      eventId: e.id, canUndo: e.undo != null, undone: !!e.undone_at, sample: e.sample as HistoryEntry['sample'],
    })),
    ...(orders ?? []).map((o) => {
      const pcs = ((o.order_items ?? []) as { quantity: number }[]).reduce((s, i) => s + i.quantity, 0);
      return {
        key: `o${o.id}`, kind: 'sale' as const, at: o.decided_at ?? o.created_at, href: `/objednavky/${o.id}`, who: null,
        title: `Prodej · objednávka č. ${o.number}`, detail: `${plural(pcs, ['kus', 'kusy', 'kusů'])} · ${formatPrice(o.total_czk)}`,
      };
    }),
    ...((invs ?? []) as Inv[]).filter((i) => i.finished_at).map((i) => {
      const diff = (i.lines ?? []).filter((l) => l.counted != null && l.counted !== l.expected).length;
      return {
        key: `i${i.id}`, kind: 'inv' as const, at: i.finished_at!, who: i.user_id ? name.get(i.user_id) ?? null : null,
        href: `/prodat?zalozka=inventura&pohled=historie`,
        title: `Inventura ${i.place}`, detail: i.status === 'review' ? 'Čeká na schválení rozdílu' : diff ? `${plural(diff, ['rozdíl', 'rozdíly', 'rozdílů'])}` : 'Vše sedí',
      };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return <StockHistory entries={entries} shop={shop} />;
}

async function Wanted() {
  const supabase = await createClient();
  const { data } = await supabase.rpc('stock_wants_view');
  const wants: Want[] = ((data ?? []) as Record<string, never>[]).map((w) => ({
    cardId: w.card_id, slug: w.slug, name: w.name, number: w.number, image: w.image_url, game: w.game_id,
    setCode: w.set_code ?? '', setName: w.set_name ?? '', maxPrice: w.max_price_czk, minCondition: w.min_condition, low: w.low_czk, offers: w.offers,
  }));
  return <WantsView wants={wants} />;
}

type SetRow = { set_id: string; code: string; name: string; game_id: string; owned: number; total: number };

async function Sets() {
  const supabase = await createClient();
  const { data } = await supabase.rpc('stock_sets');
  const sets = ((data ?? []) as SetRow[]).filter((s) => s.total > 0 && s.owned < s.total)
    .sort((a, b) => b.owned / b.total - a.owned / a.total || b.owned - a.owned).slice(0, 60);
  const { data: extra } = sets.length ? await supabase.rpc('stock_sets_extra', { p_sets: sets.map((s) => s.set_id) }) : { data: [] };
  const ex = new Map(((extra ?? []) as { set_id: string; images: string[] | null; low_sum: number; watched: number; missing: number }[]).map((x) => [x.set_id, x]));
  return <SetsView sets={sets.map((s) => {
    const x = ex.get(s.set_id);
    return { id: s.set_id, name: s.name, code: s.code, owned: s.owned, total: s.total, images: x?.images ?? [], lowSum: x?.low_sum ?? 0, watched: x?.watched ?? 0, missing: x?.missing ?? s.total - s.owned };
  })} />;
}
