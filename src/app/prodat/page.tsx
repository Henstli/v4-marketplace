import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { CardThumb } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
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
import { EMPTY_SUMMARY, countsId, toPage, type StockPageRaw, type StockSummary } from './stock-view';
import { LiveCount } from './LiveCount';
import { loadStrip } from './strip';
import { loadShipping } from './ship';
import { ShipManager } from './ShipManager';
import { InventoryViews, type InvView } from './InventoryViews';
import { loadInventory } from './inventory';
import { loadCtx, loadTeam, ROLE_NAMES, stockHref, type Perm, type StockCtx } from './team';
import { MarketViews } from './MarketViews';
import { UnmatchedView, type Unm } from './UnmatchedView';
import { Connections } from './Connections';
import { loadAuto, loadDemand, loadMarket, loadPrices, type MarketView } from './market';
import { nf } from './sk';
import styles from './sell.module.css';

export const metadata: Metadata = { title: 'Sklad' };

type Props = { searchParams: Promise<{
  zalozka?: string; druh?: string; karta?: string; hledat?: string; sada?: string; obchod?: string; pohled?: string; inventura?: string; tyden?: string; dni?: string;
}> };

type Tab = 'vse' | 'prodej' | 'odeslat' | 'trh' | 'nesparovane' | 'inventura' | 'historie' | 'hledam' | 'sady' | 'napojeni';
const TABS: Tab[] = ['vse', 'prodej', 'odeslat', 'trh', 'nesparovane', 'inventura', 'historie', 'hledam', 'sady', 'napojeni'];
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
  // Všechno, co stránka potřebuje, se načítá najednou (ne dotaz za dotazem). U vlastního skladu je majitel jasný hned,
  // u skladu obchodu (?obchod=…) až po načtení týmu. Práva hlídá databáze (stock_perm), ne tento odhad.
  const isTable = !sp.zalozka || sp.zalozka === 'vse' || sp.zalozka === 'prodej';
  const tab0 = sp.zalozka === 'prodej' ? 'sale' : 'all';
  const ctxP = loadCtx(supabase, user, sp.obchod);
  const ownerP = sp.obchod ? ctxP.then((c) => c.owner) : Promise.resolve(user.id);
  const getSummary = (mode: 'all' | 'sale') => ownerP
    .then((owner) => supabase.rpc('stock_summary', { p_owner: owner, p_mode: mode, p_shop: true }))
    .then(({ data, error }) => { if (error) console.error('stock_summary', error.message); return (data as StockSummary | null) ?? EMPTY_SUMMARY; });
  // Záložky mimo tabulku potřebují jen počty, ne celý souhrn s tržními cenami.
  const getCounts = () => ownerP
    .then((owner) => supabase.rpc('stock_counts', { p_owner: owner }))
    .then(({ data, error }) => { if (error) console.error('stock_counts', error.message); return { ...EMPTY_SUMMARY, ...((data as Partial<StockSummary> | null) ?? {}) }; });
  const getPage = (mode: 'all' | 'sale') => ownerP
    .then((owner) => supabase.rpc('stock_query', { p_owner: owner, p: { mode, page: 1, size: 10 } }))
    .then(({ data, error }) => { if (error) console.error('stock_query', error.message); return toPage(data as StockPageRaw | null); });
  const summaryP = sp.karta ? Promise.resolve(EMPTY_SUMMARY) : isTable ? getSummary(tab0) : getCounts();
  const pageP = !sp.karta && isTable ? getPage(tab0) : Promise.resolve(toPage(null));
  const stripP = !sp.karta && isTable ? ownerP.then((owner) => loadStrip(supabase, owner, true, { watchers: sp.zalozka === 'prodej' })) : Promise.resolve(null);
  for (const p of [summaryP, pageP, stripP]) p.catch(() => undefined);
  const [ctx, { data: me }, ready, { data: restriction }] = await Promise.all([
    ctxP,
    supabase.from('profiles').select('kind').eq('id', user.id).maybeSingle(),
    // Doprava a platba jsou potřeba jen u tabulky a přidání karty (výzva před vystavením).
    (isTable || sp.karta) && !sp.obchod ? loadReadiness(supabase, user.id) : Promise.resolve({ ready: true } as Awaited<ReturnType<typeof loadReadiness>>),
    supabase.from('account_restrictions').select('kind, until').eq('user_id', user.id).is('ended_at', null).maybeSingle(),
  ]);
  const myKind = (me as { kind?: string } | null)?.kind;
  const shop = ctx.isOwner ? myKind === 'shop' : true;
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
    ? { vse: has('view'), prodej: has('price'), odeslat: has('ord'), trh: has('conn'), nesparovane: ctx.isOwner, inventura: has('inv') || has('plan') || has('diff'), historie: has('conn'), hledam: false, sady: false, napojeni: has('conn') }
    : { vse: true, prodej: true, odeslat: false, trh: false, nesparovane: ctx.isOwner, inventura: false, historie: true, hledam: true, sady: true, napojeni: true };
  const order: Tab[] = shop ? ['vse', 'prodej', 'odeslat', 'trh', 'nesparovane', 'inventura', 'historie'] : ['vse', 'prodej', 'nesparovane', 'hledam', 'sady', 'historie'];
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

  // Záložka se mohla kvůli právům změnit: souhrny a první stránka musí být pro tu, která se ukáže.
  const tabMode = tab === 'prodej' ? 'sale' : 'all';
  const tabTable = tab === 'vse' || tab === 'prodej';
  const same = tabTable === isTable && (!tabTable || tabMode === tab0);
  const [summary, firstPage, strip0] = same
    ? await Promise.all([summaryP, pageP, stripP])
    : await Promise.all([tabTable ? getSummary(tabMode) : getCounts(), tabTable ? getPage(tabMode) : toPage(null),
      tabTable ? loadStrip(supabase, ctx.owner, true, { watchers: tab === 'prodej' }) : null]);
  // „Hlídá vaše karty“ je jen u obchodu.
  const strip = strip0 && !shop ? { ...strip0, watchers: null } : strip0;
  const ship = tab === 'odeslat' ? await loadShipping(supabase, ctx.owner) : null;
  const [toShip, demandN, wantsN, team, auto, unm] = await Promise.all([
    ship ? ship.orders.filter((o) => o.ready).length : can.odeslat ? supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('seller_id', ctx.owner).or('status.eq.paid,and(status.eq.confirmed,payment.in.(cod,cash))').then((r) => r.count ?? 0) : 0,
    can.trh ? supabase.rpc('market_demand', { p_owner: ctx.owner }).then((r) => (r.data ?? []).length) : 0,
    shop ? 0 : supabase.from('stock_wants').select('card_id', { count: 'exact', head: true }).eq('user_id', user.id).then((r) => r.count ?? 0),
    shop && has('staff') ? loadTeam(supabase, ctx.owner) : null,
    shop && has('conn') ? loadAuto(supabase, ctx.owner) : null,
    can.nesparovane ? loadUnmatched(supabase, tab === 'nesparovane') : { items: [] as Unm[], waiting: 0 },
  ]);
  const places = [...summary.places].sort((a, b) => a.localeCompare(b, 'cs', { numeric: true }));
  const gameNames = GAMES.filter((g) => summary.gameIds.includes(g.id)).map((g) => g.name);
  const cid = countsId(ctx.owner, summary);
  const label: Record<Tab, string> = {
    vse: 'Všechny karty', prodej: 'Na prodej', odeslat: 'K odeslání', trh: 'Trh', nesparovane: 'Nespárované', inventura: 'Inventura', historie: 'Historie',
    hledam: 'Hledám', sady: 'Chybí do sad', napojeni: 'Napojení',
  };
  const count: Partial<Record<Tab, number>> = { vse: summary.kindsAll, prodej: summary.kindsSale, odeslat: toShip, trh: demandN, hledam: wantsN, nesparovane: unm.waiting };
  const view = (VIEWS.includes(sp.pohled as InvView) ? sp.pohled : sp.inventura ? 'pocitani' : 'mista') as InvView;
  const title = shop ? 'Sklad' : 'Sbírka';

  const switcher = ctx.shops.length ? (
    <nav className="tz-stk-switch" aria-label="Čí sklad" style={{ marginBottom: 14 }}>
      <span className="t-small muted">Sklad:</span>
      <Link href="/prodat" aria-current={ctx.isOwner ? 'page' : undefined}>{myKind === 'shop' ? 'Můj obchod' : 'Moje sbírka'}</Link>
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
          total={summary.owned} />
      </div>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <Link key={t} href={href(t === 'vse' ? undefined : t)} className={tab === t ? 'on' : ''} role="tab" aria-selected={tab === t}>
            {label[t]}{t === 'vse' || t === 'prodej' ? <LiveCount k={t} n={count[t]!} id={cid} />
              : t === 'nesparovane' && !count[t] ? null : count[t] != null ? <span className={`n${t === 'nesparovane' ? ' hot' : ''}`}>{nf(count[t]!)}</span> : null}
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
          <StockTable key={`${ctx.owner}:${tab}`} owner={ctx.owner} initial={firstPage} summary={summary} mode={tab === 'prodej' ? 'sale' : 'all'} shop={shop} ready={ready.ready}
            canPrice={has('price')} canAdd={has('add')} stats={strip} unmatched={unm.waiting}
            napojeni={has('conn') ? href('napojeni') : null} ordersHref={shop && can.odeslat ? href('odeslat') : '/objednavky?tab=prodeje'} salesHref={href('historie', { druh: 'prodeje' })}
            demandHref={can.trh ? href('trh') : null} />
        </>
      ) : null}
      {tab === 'odeslat' && ship ? <ShipManager orders={ship.orders} toConfirm={ctx.isOwner ? ship.toConfirm : 0} q={ctx.q} /> : null}
      {tab === 'historie' ? <History userId={ctx.owner} shop={shop} sales={sp.druh === 'prodeje'} /> : null}
      {tab === 'inventura' ? (
        <InventoryViews data={await loadInventory(supabase, ctx.owner, user.id, ctx.ownerName, Math.max(-52, Math.min(52, Number(sp.tyden) || 0)))}
          view={view} invId={sp.inventura ? Number(sp.inventura) : undefined} owner={ctx.owner} me={user.id} perms={[...ctx.perms]} q={ctx.q}
          />
      ) : null}
      {tab === 'nesparovane' ? <UnmatchedView items={unm.items} shop={shop} /> : null}
      {tab === 'trh' ? <Market ctx={ctx} pohled={sp.pohled} dni={sp.dni} /> : null}
      {tab === 'hledam' ? <Wanted /> : null}
      {tab === 'sady' ? <Sets /> : null}
    </div></div>
  );
}

type UnmRow = {
  id: number; file: string | null; line: number | null; reason: Unm['reason']; game: string | null; name: string | null; set_code: string | null;
  set_name: string | null; number: string | null; condition: string | null; language: string | null; raw_condition: string | null;
  raw_language: string | null; price_czk: number | null; quantity: number; candidates: Unm['candidates'] | null; ignored_at: string | null;
};

/** Nespárované (jen vlastní sklad/sbírka): počet čekajících, celý seznam jen na své záložce. */
async function loadUnmatched(supabase: Awaited<ReturnType<typeof createClient>>, full: boolean): Promise<{ items: Unm[]; waiting: number }> {
  if (!full) {
    const { count } = await supabase.from('stock_unmatched').select('id', { count: 'exact', head: true }).is('ignored_at', null);
    return { items: [], waiting: count ?? 0 };
  }
  const { data } = await supabase.from('stock_unmatched')
    .select('id, file, line, reason, game, name, set_code, set_name, number, condition, language, raw_condition, raw_language, price_czk, quantity, candidates, ignored_at')
    .order('created_at', { ascending: false }).order('line', { ascending: true }).limit(5000);
  const items: Unm[] = ((data ?? []) as UnmRow[]).map((r) => ({
    id: r.id, file: r.file, line: r.line, reason: r.reason, game: r.game, name: r.name, setCode: r.set_code, setName: r.set_name, number: r.number,
    condition: r.condition, language: r.language, rawCondition: r.raw_condition, rawLanguage: r.raw_language, price: r.price_czk,
    quantity: r.quantity, candidates: r.candidates ?? [], ignored: !!r.ignored_at,
  }));
  return { items, waiting: items.filter((u) => !u.ignored).length };
}

async function Market({ ctx, pohled, dni }: { ctx: StockCtx; pohled?: string; dni?: string }) {
  const supabase = await createClient();
  const view = (['poptavka', 'trh', 'ceny'].includes(pohled ?? '') ? pohled : 'poptavka') as MarketView;
  const days = dni === '30' ? 30 : 7;
  const [demand, market, prices, have] = await Promise.all([
    view === 'poptavka' ? loadDemand(supabase, ctx.owner) : undefined,
    view === 'trh' ? loadMarket(supabase, days) : undefined,
    view === 'ceny' ? loadPrices(supabase, ctx.owner) : undefined,
    // Kusy podle karty počítá databáze (stock_have), ne celý sklad do serveru.
    view === 'trh' ? supabase.rpc('stock_have', { p_owner: ctx.owner }).then(({ data }) => (data ?? {}) as Record<string, number>) : undefined,
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

async function History({ userId, shop, sales }: { userId: string; shop: boolean; sales: boolean }) {
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
        key: `o${o.id}`, kind: 'sale' as const, at: o.decided_at ?? o.created_at, href: `/objednavky/${o.number}`, who: null,
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
  return <StockHistory entries={entries} shop={shop} initialKind={sales ? 'sale' : 'all'} />;
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
