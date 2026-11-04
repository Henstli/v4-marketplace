import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/ComingSoon';
import { ButtonLink, CardThumb } from '@/components/trezor';
import { SearchBox } from '@/components/search/SearchBox';
import { getCurrentUser } from '@/lib/auth';
import { getAccountSummary } from '@/lib/account';
import { StockTabs, type StockTab } from '@/components/account/PageTabs';
import { getCardBySlug, searchCards } from '@/lib/catalog';
import { getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatPrice, plural } from '@/lib/format';
import { loadReadiness, SellGate } from '@/components/delivery/SellGate';
import { ListingForm } from './ListingForm';
import { StockManager } from './StockManager';
import { StockHistory, type HistoryEntry } from './StockHistory';
import { WantButton, WantForm, WantsList, type Want } from './Wants';
import { loadStock } from './data';
import { loadShipping } from './ship';
import { ShipManager } from './ShipManager';
import { InventoryViews, type InvView } from './InventoryViews';
import { TeamView } from './TeamView';
import { loadInventory } from './inventory';
import { loadCtx, loadTeam, ROLE_NAMES, type Perm, type StockCtx } from './team';
import { MarketViews } from './MarketViews';
import { Connections } from './Connections';
import { loadAuto, loadDemand, loadMarket, loadPrices, type MarketView } from './market';
import styles from './sell.module.css';

export const metadata: Metadata = { title: 'Sklad' };

type Props = { searchParams: Promise<{
  zalozka?: string; karta?: string; hledat?: string; sada?: string; obchod?: string; pohled?: string; inventura?: string; tyden?: string; dni?: string;
}> };

const TABS: StockTab[] = ['vse', 'prodej', 'odeslat', 'hledam', 'sady', 'historie', 'trh', 'inventura', 'tym', 'napojeni', 'pridat'];
const MVIEWS: MarketView[] = ['poptavka', 'trh', 'ceny', 'automaticke'];
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
  // Záložky podle práv: majitel všechno (sběratel bez týmu a odesílání), člověk z týmu jen co smí.
  const allowed: StockTab[] = ctx.isOwner
    ? (shop ? ['vse', 'prodej', 'odeslat', 'historie', 'trh', 'inventura', 'tym', 'napojeni', 'pridat', 'import'] : ['vse', 'prodej', 'hledam', 'sady', 'historie', 'pridat', 'import'])
    : [
        ...(has('view') ? ['vse', 'prodej'] as StockTab[] : []),
        ...(has('ord') ? ['odeslat'] as StockTab[] : []),
        ...(has('view') ? ['historie', 'trh'] as StockTab[] : []),
        ...(has('inv') || has('plan') || has('diff') ? ['inventura'] as StockTab[] : []),
        ...(has('staff') ? ['tym'] as StockTab[] : []),
        ...(has('conn') ? ['napojeni'] as StockTab[] : []),
        ...(has('add') ? ['pridat'] as StockTab[] : []),
      ];
  // Dřívější odkazy /prodat?karta=… a ?hledat=… vedou na Přidat kartu.
  let tab = (TABS.includes(sp.zalozka as StockTab) ? sp.zalozka : sp.karta || sp.hledat ? 'pridat' : 'vse') as StockTab;
  if (!shop && tab === 'odeslat') redirect('/objednavky?tab=prodeje');
  if (!allowed.includes(tab)) tab = allowed[0] ?? 'vse';
  if (!allowed.length) {
    return <div className="container"><ComingSoon title="Sklad obchodu" text="V tomto obchodě zatím nemáte žádné právo. Požádejte vedoucího, ať vám ho nastaví." /></div>;
  }
  const base = (zalozka: string, extra = '') => `/prodat?zalozka=${zalozka}${ctx.q ? `&${ctx.q}` : ''}${extra}`;

  // Počet k odeslání v záložce (zaplacené, dobírka, hotově); celý seznam se načte jen v záložce.
  const ship = allowed.includes('odeslat') && tab === 'odeslat' ? await loadShipping(supabase, ctx.owner) : null;
  const [toShip, toReview] = await Promise.all([
    ship ? ship.orders.filter((o) => o.ready).length : allowed.includes('odeslat') ? supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('seller_id', ctx.owner).or('status.eq.paid,and(status.eq.confirmed,payment.in.(cod,cash))').then((r) => r.count ?? 0) : 0,
    shop && has('diff') ? supabase.from('inventories').select('id', { count: 'exact', head: true })
      .eq('owner_id', ctx.owner).eq('status', 'review').then((r) => r.count ?? 0) : 0,
  ]);
  const view = (VIEWS.includes(sp.pohled as InvView) ? sp.pohled : sp.inventura ? 'pocitani' : 'mista') as InvView;
  const title = !ctx.isOwner ? `Sklad · ${ctx.ownerName}` : shop ? 'Sklad' : 'Sbírka';

  return (
    <div className={`container ${styles.page}`}>
      <div>
        {ctx.shops.length ? (
          <nav className="tz-stk-switch" aria-label="Čí sklad">
            <span className="t-small muted">Sklad:</span>
            <Link href="/prodat" aria-current={ctx.isOwner ? 'page' : undefined}>{account?.kind === 'shop' ? 'Můj obchod' : 'Moje sbírka'}</Link>
            {ctx.shops.map((s) => (
              <Link key={s.owner} href={`/prodat?obchod=${s.owner}`} aria-current={ctx.owner === s.owner ? 'page' : undefined}>
                {s.name}<small>{ROLE_NAMES[s.role] ?? ''}</small>
              </Link>
            ))}
          </nav>
        ) : null}
        <div className={styles.sectionHead}>
          <h1 className="t-heading-l">{title}</h1>
          <div className={styles.headActions}>
            {ctx.isOwner ? (
              <>
                <a href="/prodat/export?druh=pojisteni" className="tz-btn tz-btn-ghost tz-btn-md" download>Přehled pro pojištění</a>
                <a href="/prodat/export" className="tz-btn tz-btn-ghost tz-btn-md" download>Exportovat (CSV)</a>
                {shop ? null : <a href="/prodat/export?druh=deckbuilder" className="tz-btn tz-btn-ghost tz-btn-md" download>Pro Moxfield</a>}
              </>
            ) : <span className="t-small muted">Jste v týmu jako {ROLE_NAMES[ctx.role] ?? ctx.role}</span>}
            {allowed.includes('pridat') ? <ButtonLink href={base('pridat')} variant="secondary">Přidat kartu</ButtonLink> : null}
          </div>
        </div>
        <StockTabs current={tab} shop={shop} onSale={ctx.isOwner ? account?.listings ?? 0 : undefined} toShip={toShip} toReview={toReview} allowed={allowed} q={ctx.q} />
      </div>

      {restriction && ctx.isOwner ? (
        <p className={styles.restricted}>
          <strong>Vystavování máte omezené podporou V4cards{restriction.until ? ` do ${formatDate(restriction.until)}` : ''}.</strong>{' '}
          Nabídky jsou skryté a nové nejde vystavit. Odůvodnění jsme vám poslali e-mailem, ohradit se můžete na{' '}
          <a href="mailto:podpora@v4cards.com">podpora@v4cards.com</a>.
        </p>
      ) : null}

      {tab === 'vse' || tab === 'prodej' ? (
        <>
          {ready.ready ? null : <SellGate r={ready} back="prodat" />}
          <StockManager key={tab} items={await loadStock(supabase, ctx.owner)} mode={tab === 'prodej' ? 'sale' : 'all'} shop={shop} ready={ready.ready} />
        </>
      ) : null}
      {tab === 'pridat' ? (
        <AddCard q={sp.hledat?.trim()} karta={sp.karta} ready={ready.ready} shop={shop} owner={ctx.isOwner ? undefined : ctx.owner} base={base}
          gate={ready.ready ? null : <SellGate r={ready} back="prodat" />} />
      ) : null}
      {tab === 'odeslat' && ship ? <ShipManager orders={ship.orders} toConfirm={ctx.isOwner ? ship.toConfirm : 0} q={ctx.q} /> : null}
      {tab === 'historie' ? <History userId={ctx.owner} shop={shop} /> : null}
      {tab === 'inventura' ? (
        <InventoryViews data={await loadInventory(supabase, ctx.owner, user.id, ctx.ownerName, Math.max(-52, Math.min(52, Number(sp.tyden) || 0)))}
          view={view} invId={sp.inventura ? Number(sp.inventura) : undefined} owner={ctx.owner} me={user.id} perms={[...ctx.perms]} q={ctx.q} />
      ) : null}
      {tab === 'trh' ? <Market ctx={ctx} pohled={sp.pohled} dni={sp.dni} /> : null}
      {tab === 'napojeni' ? <Connections isOwner={ctx.isOwner} /> : null}
      {tab === 'tym' ? <TeamView owner={ctx.owner} ownerName={ctx.ownerName} me={user.id} isOwner={ctx.isOwner} team={await loadTeam(supabase, ctx.owner)} /> : null}
      {tab === 'hledam' ? <Wanted q={sp.hledat?.trim()} karta={sp.karta} /> : null}
      {tab === 'sady' ? <Sets set={sp.sada} /> : null}
    </div>
  );
}

async function Market({ ctx, pohled, dni }: { ctx: StockCtx; pohled?: string; dni?: string }) {
  const supabase = await createClient();
  const can = ctx.perms.has('price') || ctx.perms.has('conn');
  let view = (MVIEWS.includes(pohled as MarketView) ? pohled : 'poptavka') as MarketView;
  if (view === 'automaticke' && !can) view = 'poptavka';
  const days = dni === '30' ? 30 : 7;
  const [demand, market, prices, auto, places] = await Promise.all([
    view === 'poptavka' ? loadDemand(supabase, ctx.owner) : undefined,
    view === 'trh' ? loadMarket(supabase, days) : undefined,
    view === 'ceny' ? loadPrices(supabase, ctx.owner) : undefined,
    view === 'automaticke' ? loadAuto(supabase, ctx.owner) : undefined,
    view === 'automaticke' ? supabase.from('listing_stock').select('location').eq('seller_id', ctx.owner).not('location', 'is', null).limit(5000)
      .then((r) => [...new Set(((r.data ?? []) as { location: string }[]).map((x) => x.location))].sort((a, b) => a.localeCompare(b, 'cs', { numeric: true }))) : [],
  ]);
  return <MarketViews view={view} q={ctx.q} perms={[...ctx.perms]} owner={ctx.owner} days={days} demand={demand} market={market} prices={prices} auto={auto} places={places} />;
}

async function AddCard({ q, karta, ready, shop, gate, owner, base }: {
  q?: string; karta?: string; ready: boolean; shop: boolean; gate: React.ReactNode; owner?: string; base: (zalozka: string, extra?: string) => string;
}) {
  const [selected, found] = await Promise.all([karta ? getCardBySlug(karta) : null, q ? searchCards({ q, pageSize: 12 }) : null]);
  return (
    <section className="panel">
      <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Přidat kartu do {shop ? 'skladu' : 'sbírky'}</h2>
      {selected ? (
        <>
          <div className={styles.picked}>
            <CardThumb size="lg" image={thumbUrl(selected.image)} preview={selected.image} color={`var(--game-${selected.game}-art)`} />
            <div className={styles.grow}>
              <p className="t-label muted">KARTA</p>
              <Link href={`/karty/${selected.slug}`} className={styles.rowName}>{selected.name}</Link>
              <div className="t-small muted">{selected.setName} · <span className="code">{selected.setCode} {selected.number}</span> · {getGame(selected.game)?.name}</div>
            </div>
            <ButtonLink href={base('pridat')} variant="ghost">Změnit kartu</ButtonLink>
          </div>
          {ready || owner ? null : gate}
          <ListingForm cardId={selected.id} ready={ready} shop={shop} owner={owner} />
        </>
      ) : (
        <>
          <SearchBox key={q ?? ''} className={styles.search} action="/prodat" param="hledat" keep={owner ? { zalozka: 'pridat', obchod: owner } : { zalozka: 'pridat' }}
            cardHref={base('pridat', '&karta=')} defaultValue={q} placeholder="Název karty, sada nebo číslo" label="Najít kartu v katalogu" />
          <Results found={found} href={base('pridat', '&karta=')} />
          {owner ? null : <p className={`t-small muted ${styles.suggest}`}>
            Hodně karet najednou? <Link href="/prodat/import">Nahrajte tabulku</Link> (CSV, Excel, export z Cardmarketu). Hokejovou nebo jinou sportovní kartu v katalogu nenajdete?{' '}
            <Link href="/prodat/nova-karta">Navrhněte ji</Link> a my ji po schválení přidáme.
          </p>}
        </>
      )}
    </section>
  );
}

function Results({ found, href }: { found: Awaited<ReturnType<typeof searchCards>> | null; href: string }) {
  if (!found) return <p className="t-small muted">Napište název karty a vyberte ji z výsledků.</p>;
  if (!found.cards.length) return <p className="muted">Kartu jsme v katalogu nenašli. Zkuste jiný název nebo číslo.</p>;
  return (
    <div className={styles.list}>
      {found.cards.map((c) => (
        <Link key={c.id} href={`${href}${c.slug}`} className={styles.result}>
          <CardThumb image={thumbUrl(c.image)} preview={c.image} color={`var(--game-${c.game}-art)`} />
          <span className={styles.resultText}>
            <span className={styles.rowName}>{c.name}</span>
            <span className="t-small muted">{c.setName} · <span className="code">{c.setCode} {c.number}</span> · {getGame(c.game)?.name}</span>
          </span>
        </Link>
      ))}
      {found.total > found.cards.length ? (
        <p className="t-small muted">Zobrazeno {found.cards.length} z {found.total}. Upřesněte hledání, třeba přidejte sadu nebo číslo karty.</p>
      ) : null}
    </div>
  );
}

async function History({ userId, shop }: { userId: string; shop: boolean }) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 365 * 86400000).toISOString();
  const [{ data: events }, { data: orders }] = await Promise.all([
    supabase.from('stock_events').select('id, kind, title, detail, created_at, undo, sample, undone_at')
      .eq('owner_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(500),
    supabase.from('orders').select('id, number, total_czk, status, created_at, decided_at, order_items(quantity)')
      .eq('seller_id', userId).in('status', SOLD).gte('created_at', since).order('created_at', { ascending: false }).limit(300),
  ]);
  const entries: HistoryEntry[] = [
    ...(events ?? []).map((e) => ({
      key: `e${e.id}`, kind: e.kind as HistoryEntry['kind'], title: e.title, detail: e.detail, at: e.created_at,
      eventId: e.id, canUndo: e.undo != null, undone: !!e.undone_at, sample: e.sample as HistoryEntry['sample'],
    })),
    ...(orders ?? []).map((o) => {
      const pcs = ((o.order_items ?? []) as { quantity: number }[]).reduce((s, i) => s + i.quantity, 0);
      return {
        key: `o${o.id}`, kind: 'sale' as const, at: o.decided_at ?? o.created_at, href: `/objednavky/${o.id}`,
        title: `Prodej · objednávka č. ${o.number}`, detail: `${plural(pcs, ['kus', 'kusy', 'kusů'])} · ${formatPrice(o.total_czk)}`,
      };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return <StockHistory entries={entries} shop={shop} />;
}

async function Wanted({ q, karta }: { q?: string; karta?: string }) {
  const supabase = await createClient();
  const [{ data }, selected, found] = await Promise.all([
    supabase.rpc('stock_wants_view'),
    karta ? getCardBySlug(karta) : null,
    q && !karta ? searchCards({ q, pageSize: 8 }) : null,
  ]);
  const wants: Want[] = ((data ?? []) as Record<string, never>[]).map((w) => ({
    cardId: w.card_id, slug: w.slug, name: w.name, number: w.number, image: w.image_url, game: w.game_id,
    setCode: w.set_code ?? '', setName: w.set_name ?? '', maxPrice: w.max_price_czk, minCondition: w.min_condition, low: w.low_czk, offers: w.offers,
  }));
  return (
    <>
      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Přidat hledanou kartu</h2>
        {selected ? (
          <div className={styles.picked}>
            <CardThumb size="lg" image={thumbUrl(selected.image)} preview={selected.image} color={`var(--game-${selected.game}-art)`} />
            <div className={styles.grow}>
              <Link href={`/karty/${selected.slug}`} className={styles.rowName}>{selected.name}</Link>
              <div className="t-small muted">{selected.setName} · <span className="code">{selected.setCode} {selected.number}</span></div>
              <WantForm cardId={selected.id} done="Karta je v Hledám. Ukážeme, až bude za vaši cenu." />
            </div>
            <ButtonLink href="/prodat?zalozka=hledam" variant="ghost">Jiná karta</ButtonLink>
          </div>
        ) : (
          <>
            <SearchBox key={q ?? ''} className={styles.search} action="/prodat" param="hledat" keep={{ zalozka: 'hledam' }}
              cardHref="/prodat?zalozka=hledam&karta=" defaultValue={q} placeholder="Kterou kartu sháníte?" label="Najít kartu v katalogu" />
            {found ? <Results found={found} href="/prodat?zalozka=hledam&karta=" /> : null}
          </>
        )}
      </section>
      <WantsList wants={wants} />
    </>
  );
}

type SetRow = { set_id: string; code: string; name: string; game_id: string; owned: number; total: number };

async function Sets({ set }: { set?: string }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('stock_sets');
  const sets = ((data ?? []) as SetRow[])
    .filter((s) => s.total > 0)
    .sort((a, b) => b.owned / b.total - a.owned / a.total || b.owned - a.owned);
  const open = set ? sets.find((s) => s.set_id === set) : null;
  let missing: { card_id: string; slug: string; name: string; number: string; low_czk: number | null; offers: number }[] = [];
  let wanted = new Set<string>();
  if (open) {
    const [{ data: m }, { data: w }] = await Promise.all([
      supabase.rpc('stock_set_missing', { p_set: open.set_id }),
      supabase.from('stock_wants').select('card_id'),
    ]);
    missing = (m ?? []) as typeof missing;
    wanted = new Set((w ?? []).map((x) => x.card_id as string));
  }
  if (!sets.length) {
    return <div className="tz-stk-empty"><b>Zatím tu nic není</b>Jakmile budete mít ve sbírce kartu, ukážeme, kolik vám chybí do celé sady.</div>;
  }
  return (
    <div className="tz-stk-sets">
      {(open ? [open] : sets.slice(0, 60)).map((s) => {
        const pct = Math.round((s.owned / s.total) * 100);
        return (
          <div key={s.set_id} className="tz-stk-set" style={open ? { gridColumn: '1 / -1' } : undefined}>
            <header><b>{s.name}</b><span className="t-small muted tz-stk-code">{s.code}</span></header>
            <div className="t-small muted">{getGame(s.game_id)?.name} · {s.owned} z {s.total} · {pct} %</div>
            <div className="tz-stk-prog"><i style={{ width: `${pct}%` }} /></div>
            {open ? (
              <>
                <div className="tz-stk-tools">
                  <span className="t-small">Chybí {plural(missing.length, ['karta', 'karty', 'karet'])}, od nejlevnější nabídky.</span>
                  <ButtonLink href="/prodat?zalozka=sady" variant="ghost" size="sm">Všechny sady</ButtonLink>
                </div>
                <div className="tz-stk-miss">
                  {missing.map((c) => (
                    <div key={c.card_id}>
                      <span><Link href={`/karty/${c.slug}`}>{c.name}</Link> <span className="t-small muted tz-stk-code">{c.number}</span></span>
                      <span className="tz-num">{c.low_czk != null ? `od ${formatPrice(c.low_czk)}` : <span className="tz-stk-muted">nikdo nenabízí</span>}</span>
                      <WantButton cardId={c.card_id} wanted={wanted.has(c.card_id)} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <ButtonLink href={`/prodat?zalozka=sady&sada=${s.set_id}`} variant="secondary" size="sm">Zobrazit chybějící ({s.total - s.owned})</ButtonLink>
            )}
          </div>
        );
      })}
    </div>
  );
}
