'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { AlbumBook } from '@/components/album/AlbumBook';
import { AlbumViewer, type AlbumHandle } from '@/components/album/AlbumViewer';
import { cardsWord } from '@/components/album/engine';
import { Button, ButtonLink, PlusIcon, SearchField } from '@/components/trezor';
import { WatchButton } from '@/components/WatchButton';
import type { AlbumCard, AlbumDetail } from '@/lib/collection';
import { formatNumber } from '@/lib/format';
import { getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { addCards, cardOffers, deleteAlbum, markAlbumSeen, setAlbumAutoFill, removeCard, searchForAlbum, setAlbumOnProfile, stockInfo, updateAlbum, type AddOpts, type CheapOffer, type PickCard, type StockInfo } from '../actions';
import { HaveForm } from '../HaveForm';
import { AlbumLook } from '../AlbumLook';
import { CardPicker } from '../CardPicker';
import s from '../kolekce.module.css';
import { shortAlbumName } from '@/lib/album/designs';

const Kc = ({ n }: { n: number }) => <>{formatNumber(Math.round(n))}&nbsp;Kč</>;

export function AlbumScreen({ album, founding }: { album: AlbumDetail; founding: boolean }) {
  const router = useRouter();
  const view = useRef<AlbumHandle>(null);
  // Karty doplněné ze skladu od posledního otevření: nejdřív prázdné kapsy, pak se vloží s animací.
  const freshSet = useMemo(() => new Set(founding ? [] : album.fresh), [founding, album.fresh]);
  const [cards, setCards] = useState<AlbumCard[]>(() => album.cards.map((c) => (freshSet.has(c.id) ? { ...c, owned: 0 } : c)));
  const [autoFill, setAutoFill] = useState(album.autoFill);
  const [look, setLook] = useState({ name: album.name, design: album.design, sleeve: album.sleeve });
  const [sel, setSel] = useState<number | null>(null);
  const [offers, setOffers] = useState<{ id: string; list: CheapOffer[]; count: number } | null>(null);
  const [drawer, setDrawer] = useState<null | 'add' | 'look'>(null);
  const [onProfile, setOnProfile] = useState(album.onProfile);
  const [err, setErr] = useState('');
  // Karta, kterou ve sbírce nemáte (zeptáme se na stav a jazyk), nebo máte jen na prodeji.
  const [need, setNeed] = useState<{ id: string; kind: 'missing' | 'sale' } | null>(null);
  const [pending, start] = useTransition();
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const have = cards.filter((c) => c.owned > 0).length;
  const stockIds = album.fromStock.filter((id) => cards.some((c) => c.id === id && !c.owned));
  const value = cards.reduce((a, c) => a + (c.owned && c.minPrice ? c.minPrice * c.owned : 0), 0);
  const g = album.game ? getGame(album.game) : undefined;
  const selCard = sel !== null ? cards[sel] : null;

  // založení (3B): album se otevře a karty se vloží z balíčku
  useEffect(() => {
    if (!founding) return;
    window.history.replaceState(null, '', `/kolekce/${album.id}`);
    const idx = album.cards.map((c, i) => (c.owned > 0 ? i : -1)).filter((i) => i >= 0);
    const t = setTimeout(() => {
      if (idx.length) view.current?.play(idx, { founding: true });
      else view.current?.showCard(0, false);
    }, 250);
    return () => clearTimeout(t);
  }, [founding, album.id, album.cards]);

  // Doplněné karty se při prvním otevření vloží jako při přidání více karet (2B).
  useEffect(() => {
    if (founding) return;
    if (!freshSet.size) { markAlbumSeen(album.id); return; }
    const t = setTimeout(() => {
      const idx: number[] = [];
      const next = cardsRef.current.map((c, i) => {
        const orig = album.cards.find((x) => x.id === c.id);
        if (!freshSet.has(c.id) || !orig) return c;
        idx.push(i);
        return { ...c, owned: orig.owned || 1 };
      });
      apply(next);
      Promise.resolve(view.current?.play(idx)).finally(() => markAlbumSeen(album.id));
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selCard || selCard.owned) { setOffers(null); return; }
    let alive = true;
    cardOffers(selCard.id).then((r) => { if (alive) setOffers({ id: selCard.id, list: r.offers, count: r.count }); });
    return () => { alive = false; };
  }, [selCard]);

  const apply = (next: AlbumCard[]) => { setCards(next); cardsRef.current = next; view.current?.setCards(next); };

  /** Uloží karty do sbírky a vloží je do alba s animací (1B jedna karta, 2B více karet). */
  const insert = (ids: string[], extra: AlbumCard[] = [], o: AddOpts = {}) =>
    start(async () => {
      setErr('');
      setNeed(null);
      const r = await addCards(ids, album.id, o);
      if ('error' in r) { setErr(r.error === 'login' ? 'Přihlaste se znovu.' : r.error); return; }
      // Kolekce bere karty jen ze sbírky: co tam není, se nevloží.
      if (ids.length === 1 && !r.added.length) { setNeed({ id: ids[0], kind: r.onSale.length ? 'sale' : 'missing' }); return; }
      const skipped = r.onSale.length + r.missing.length;
      if (skipped) setErr(`Nevloženo: ${skipped} ${cardsWord(skipped)}, ve sbírce ${skipped === 1 ? 'ji' : 'je'} nemáte mimo prodej.`);
      const added = new Set(r.added);
      const base = [...cardsRef.current, ...extra.filter((e) => added.has(e.id) && !cardsRef.current.some((c) => c.id === e.id))];
      const fresh: number[] = [];
      const next = base.map((c, i) => {
        if (!added.has(c.id)) return c;
        if (!c.owned) fresh.push(i);
        return { ...c, owned: 1 };
      });
      apply(next);
      setSel(null);
      setDrawer(null);
      if (fresh.length) await view.current?.play(fresh);
      await markAlbumSeen(album.id);
      router.refresh();
    });

  const remove = (c: { id: string }, i: number) =>
    start(async () => {
      const r = await removeCard(c.id, album.id);
      if ('error' in r) { setErr('Kartu se nepodařilo odebrat.'); return; }
      let next = cardsRef.current.map((x, j) => (j === i ? { ...x, owned: Math.max(0, x.owned - 1) } : x));
      if (album.kind === 'custom' && next[i].owned === 0) next = next.filter((_, j) => j !== i);
      apply(next);
      router.refresh();
    });

  return (
    <main className={s.wrap}>
      <div className={s.crumb}><Link href="/kolekce">Moje kolekce</Link><span>›</span><span title={look.name}>{shortAlbumName(look.name)}</span></div>
      <div className={s.ahead}>
        <div className={s.atitle}>
          <AlbumBook design={look.design} name={look.name} scale={0.3} />
          <div>
            <h1 title={look.name}>{shortAlbumName(look.name)}</h1>
            <div className={s.meta}>
              {g ? <span className={s.dot} style={{ background: g.dot }} /> : null}
              <span>{album.kind === 'set' ? `${g?.name ?? ''} · ${album.setName ?? ''}${album.setYear ? ` · ${album.setYear}` : ''}` : 'Vlastní album'}</span>
              {album.kind === 'set' ? (
                <>
                  <span className={s.minibar}><i style={{ width: `${cards.length ? (have / cards.length) * 100 : 0}%` }} /></span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}><b style={{ color: 'var(--ink)' }}>{have}</b> / {cards.length}</span>
                </>
              ) : <span>· {cards.length} {cardsWord(cards.length)}</span>}
              <span>· Hodnota <b style={{ color: 'var(--ink)' }}><Kc n={value} /></b></span>
            </div>
          </div>
        </div>
        <div className={s.actions}>
          <Button
            variant="secondary"
            aria-pressed={!onProfile}
            title={onProfile ? 'Album je vidět na tvém profilu' : 'Album na profilu nikdo nevidí'}
            onClick={async () => {
              const next = !onProfile;
              setOnProfile(next);
              const r = await setAlbumOnProfile(album.id, next);
              if ('error' in r) setOnProfile(!next);
            }}
          >
            {onProfile ? 'Skrýt z profilu' : 'Ukázat na profilu'}
          </Button>
          <Button variant="secondary" onClick={() => setDrawer('look')}>Vzhled alba</Button>
          <Button onClick={() => setDrawer('add')}><PlusIcon />Přidat karty</Button>
        </div>
      </div>

      <div className={s.full}>
        <div className={s.stage} style={{ position: 'relative' }}>
          {stockIds.length ? (
            // Hromádka karet ze skladu na místě, odkud karty při vkládání létají (album se samo nedoplňuje).
            <button type="button" className={s.stockPile} disabled={pending} onClick={() => insert(stockIds)}
              title="Karty alba, které máte ve skladu mimo prodej">
              <span className={s.spCards}>
                {stockIds.slice(0, 3).reverse().map((id, i, a) => {
                  const c = cards.find((x) => x.id === id);
                  const k = a.length - 1 - i;
                  // eslint-disable-next-line @next/next/no-img-element
                  return c?.image ? <img key={id} src={thumbUrl(c.image) ?? c.image} alt="" style={{ transform: `translate(${k * -2}px, ${k * -4}px) rotate(${k * -2}deg)` }} /> : null;
                })}
              </span>
              <b>{stockIds.length}</b>
              <small>{stockIds.length === 1 ? 'karta' : stockIds.length < 5 ? 'karty' : 'karet'} ze skladu</small>
              <em>Vložit do alba</em>
            </button>
          ) : null}
          <AlbumViewer
            key={`${look.design}-${look.sleeve}`}
            ref={view}
            name={look.name}
            design={look.design}
            sleeve={look.sleeve}
            cards={cards}
            open={false}
            counterTotal={album.kind === 'set'}
            onEmpty={(_c, i) => setSel(i)}
            onRemove={remove}
          />
          {!cards.length ? <p className={s.hint} style={{ textAlign: 'center' }}>Album je prázdné. Přidej do něj karty tlačítkem Přidat karty.</p> : null}
          {err && !selCard ? <p className={s.err} style={{ textAlign: 'center' }}>{err}</p> : null}
        </div>
      </div>

      {selCard && !selCard.owned ? (
        <Drawer title="Chybějící karta" onClose={() => { setSel(null); view.current?.select(null); }}>
          <div className={s.pHead}>
            <b>#{selCard.number}{album.kind === 'set' ? ` / ${cards.length}` : ''}</b>
            <span className={s.tag}>Chybí</span>
          </div>
          <div className={s.pCard}>
            <div className={`${s.mcImg} ${s.missing}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {selCard.image ? <img src={thumbUrl(selCard.image) ?? selCard.image} alt={selCard.name} /> : null}
            </div>
            <div>
              <h4>{selCard.name}</h4>
              <p>{[selCard.rarity, selCard.setName].filter(Boolean).join(' · ')}</p>
              {selCard.minPrice ? <p>Nejnižší cena <b><Kc n={selCard.minPrice} /></b></p> : <p>Teď ji nikdo neprodává.</p>}
            </div>
          </div>
          <div className={s.pBtns}>
            <Button disabled={pending} onClick={() => insert([selCard.id])}>Mám ji, vložit do alba</Button>
            {selCard.offers ? (
              <ButtonLink variant="secondary" href={`/karty/${selCard.slug}`}>
                Zobrazit {selCard.offers} {selCard.offers === 1 ? 'nabídku' : selCard.offers <= 4 ? 'nabídky' : 'nabídek'}
              </ButtonLink>
            ) : <ButtonLink variant="secondary" href={`/karty/${selCard.slug}`}>Detail karty</ButtonLink>}
            <WatchButton cardId={selCard.id} size="md" />
          </div>
          {need?.id === selCard.id && need.kind === 'missing' ? (
            <HaveForm name={selCard.name} pending={pending} onCancel={() => setNeed(null)} onSave={(cond, lang) => insert([selCard.id], [], { cond, lang })} />
          ) : null}
          {need?.id === selCard.id && need.kind === 'sale' ? (
            <div className={s.have}>
              <p className={s.hint} style={{ margin: 0 }}>Jediný kus máte na prodeji. Album si ho vezme a z prodeje se stáhne.</p>
              <div className={s.haveBtns}>
                <Button variant="ghost" size="md" onClick={() => setNeed(null)}>Nechat na prodeji</Button>
                <Button size="md" disabled={pending} onClick={() => insert([selCard.id], [], { unsell: true })}>Stáhnout z prodeje a vložit</Button>
              </div>
            </div>
          ) : null}
          {err ? <p className={s.err}>{err}</p> : null}
          {offers?.id === selCard.id && offers.list.length ? (
            <div className={s.offers}>
              <h3>Nejlevnější nabídky</h3>
              {offers.list.map((o, i) => (
                <div key={i} className={s.offer}>
                  <div>{o.seller}<small>{o.condition}</small></div>
                  <strong>{o.price != null ? <Kc n={o.price} /> : 'dohodou'}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </Drawer>
      ) : null}

      {drawer === 'add' ? (
        <AddDrawer album={album} cards={cards} pending={pending} onClose={() => setDrawer(null)} onAdd={insert} />
      ) : null}
      {drawer === 'look' ? (
        <Drawer title="Vzhled alba" onClose={() => setDrawer(null)}>
          <label className={s.hint} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', margin: '0 0 14px' }}>
            <input type="checkbox" checked={autoFill} onChange={async (e) => {
              const on = e.target.checked;
              setAutoFill(on);
              const r = await setAlbumAutoFill(album.id, on);
              if ('error' in r) setAutoFill(!on);
            }} />
            Doplňovat samo: kartu {album.kind === 'set' ? 'této sady' : 'z tohoto alba'}, kterou naskladníte, vložíme do alba
          </label>
          <AlbumLook
            value={look}
            onSave={async (v) => {
              const r = await updateAlbum(album.id, v);
              if ('error' in r) return r.error;
              if (v.name !== look.name && v.design === look.design && v.sleeve === look.sleeve) view.current?.rename(v.name);
              setLook(v);
              setDrawer(null);
              router.refresh();
              return null;
            }}
            onDelete={async () => {
              if (!window.confirm(`Smazat album „${look.name}“? Karty ti zůstanou ve sbírce.`)) return;
              const r = await deleteAlbum(album.id);
              if (!('error' in r)) router.push('/kolekce');
            }}
          />
        </Drawer>
      ) : null}
    </main>
  );
}

export function Drawer({ title, onClose, children, foot }: { title: string; onClose: () => void; children: React.ReactNode; foot?: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className={s.drawerBg} onClick={onClose} />
      <div className={s.drawer} role="dialog" aria-label={title}>
        <div className={s.dHead}><h2>{title}</h2><button type="button" className={s.close} onClick={onClose} aria-label="Zavřít">×</button></div>
        <div className={s.dBody}>{children}</div>
        {foot ? <div className={s.dFoot}>{foot}</div> : null}
      </div>
    </>
  );
}

/** Přidat karty (2B): u alba sady chybějící karty, u vlastního alba hledání v katalogu. Vložit jde jen karty ze sbírky. */
function AddDrawer({ album, cards, pending, onClose, onAdd }: {
  album: AlbumDetail; cards: AlbumCard[]; pending: boolean; onClose: () => void; onAdd: (ids: string[], extra?: AlbumCard[], o?: AddOpts) => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Map<string, number>>(new Map());
  const [found, setFound] = useState<PickCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [st, setSt] = useState<Record<string, StockInfo> | null>(null);
  const [mam, setMam] = useState<string | null>(null);
  const known = useRef(new Map<string, PickCard>());

  useEffect(() => {
    if (album.kind !== 'custom') return;
    if (q.trim().length < 2) { setFound([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      searchForAlbum(q, album.game).then((r) => { r.forEach((c) => known.current.set(c.id, c)); setFound(r); setLoading(false); });
    }, 280);
    return () => clearTimeout(t);
  }, [q, album.kind, album.game]);

  // U alba sady: kolik kusů chybějících karet je ve sbírce.
  useEffect(() => {
    if (album.kind !== 'set') return;
    stockInfo(cards.filter((c) => !c.owned).map((c) => c.id)).then(setSt).catch(() => setSt({}));
  }, [album.kind, cards]);

  type Row = { id: string; name: string; number: string; image: string | null; have: number; keep: number; sale: number };
  const rows: Row[] = useMemo(() => {
    if (album.kind === 'custom') return found.map((c) => ({ id: c.id, name: c.name, number: c.number, image: c.image, have: c.owned, keep: c.keep ?? 0, sale: c.sale ?? 0 }));
    const needle = q.trim().toLocaleLowerCase('cs');
    return cards.filter((c) => !c.owned && (!needle || c.name.toLocaleLowerCase('cs').includes(needle) || c.number.toLowerCase().startsWith(needle)))
      .map((c) => ({ id: c.id, name: c.name, number: c.number, image: c.image, have: st?.[c.id]?.have ?? 0, keep: st?.[c.id]?.keep ?? 0, sale: st?.[c.id]?.sale ?? 0 }));
  }, [album.kind, cards, found, q, st]);
  const inStock = rows.filter((r) => r.have > 0);
  const outside = rows.filter((r) => r.have === 0);
  const saleOnly = [...picked.keys()].filter((id) => { const r = rows.find((x) => x.id === id); return r && r.keep === 0 && r.sale > 0; });

  const total = picked.size;
  const extraOf = (ids: string[]): AlbumCard[] => album.kind === 'custom'
    ? ids.map((id) => known.current.get(id)).filter((c): c is PickCard => !!c).map((c) => ({
      id: c.id, slug: c.slug, name: c.name, number: c.number, rarity: c.rarity, image: c.image, setName: c.setName,
      game: album.game ?? 'pokemon', owned: 0, minPrice: c.minPrice ?? null, offers: 0,
    }))
    : [];
  const submit = () => {
    const ids = [...picked.keys()];
    onAdd(ids, extraOf(ids), { unsell: saleOnly.length > 0 });
  };

  return (
    <Drawer
      title="Přidat karty"
      onClose={onClose}
      foot={
        <>
          <span className={s.hint} style={{ margin: 0 }}>{total ? `Vybráno ${total} ${cardsWord(total)}` : 'Klikni na karty, které máš'}</span>
          <Button disabled={!total || pending} onClick={submit}>{pending ? 'Vkládám…' : `Vložit do alba${total ? ` (${total})` : ''}`}</Button>
        </>
      }
    >
      <div className={s.toolbar}>
        <SearchField
          label={album.kind === 'custom' ? 'Hledat kartu' : 'Hledat v chybějících'}
          placeholder={album.kind === 'custom' ? 'Název karty, sada nebo číslo' : 'Jméno nebo číslo karty'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>
      <p className={s.hint}>Do alba jdou karty ze sbírky, album si z každé vezme 1 kus. {album.kind === 'custom' ? 'Karty se přidají na konec alba.' : 'Tažením přes karty označíš víc najednou.'}</p>
      {loading || (album.kind === 'set' && !st) ? <p className={s.hint}>Načítám…</p> : null}
      {inStock.length ? <CardPicker cards={inStock.map((r) => ({ id: r.id, name: r.name, number: r.number, image: r.image, have: r.have }))} value={picked}
        onChange={(m) => setPicked(new Map([...m.keys()].map((k) => [k, 1])))} /> : null}
      {saleOnly.length ? <p className={s.saleNote}>{saleOnly.length === 1 ? '1 vybranou kartu máte jen na prodeji, vložením se stáhne z prodeje.' : `${saleOnly.length} vybrané karty máte jen na prodeji, vložením se stáhnou z prodeje.`}</p> : null}
      {outside.length ? (
        <div style={{ marginTop: 'var(--space-5)' }}>
          <p className={s.hint} style={{ margin: '0 0 6px' }}>Nemáte ve sbírce ({outside.length})</p>
          {outside.slice(0, 40).map((r) => (
            <div key={r.id}>
              <div className={s.miss}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r.image ? <img src={thumbUrl(r.image) ?? r.image} alt="" /> : <span />}
                <span><b>{r.name}</b><small>#{r.number}</small></span>
                <Button variant="secondary" size="sm" onClick={() => setMam(mam === r.id ? null : r.id)}>Mám ji</Button>
              </div>
              {mam === r.id ? <HaveForm name={r.name} pending={pending} onCancel={() => setMam(null)} onSave={(cond, lang) => onAdd([r.id], extraOf([r.id]), { cond, lang })} /> : null}
            </div>
          ))}
        </div>
      ) : null}
      {album.kind === 'set' && !rows.length && st ? <p className={s.hint}>{q ? 'Nic nenalezeno.' : 'Album je kompletní.'}</p> : null}
    </Drawer>
  );
}
