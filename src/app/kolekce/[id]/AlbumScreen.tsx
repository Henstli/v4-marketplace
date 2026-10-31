'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { AlbumBook } from '@/components/album/AlbumBook';
import { AlbumViewer, type AlbumHandle } from '@/components/album/AlbumViewer';
import { cardsWord } from '@/components/album/engine';
import { Button, ButtonLink, SearchField } from '@/components/trezor';
import { WatchButton } from '@/components/WatchButton';
import type { AlbumCard, AlbumDetail } from '@/lib/collection';
import { formatNumber } from '@/lib/format';
import { getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { addCards, cardOffers, deleteAlbum, removeCard, searchForAlbum, updateAlbum, type CheapOffer, type PickCard } from '../actions';
import { AlbumLook } from '../AlbumLook';
import { CardPicker } from '../CardPicker';
import s from '../kolekce.module.css';

const Kc = ({ n }: { n: number }) => <>{formatNumber(Math.round(n))}&nbsp;Kč</>;

export function AlbumScreen({ album, founding }: { album: AlbumDetail; founding: boolean }) {
  const router = useRouter();
  const view = useRef<AlbumHandle>(null);
  const [cards, setCards] = useState<AlbumCard[]>(album.cards);
  const [look, setLook] = useState({ name: album.name, design: album.design, sleeve: album.sleeve });
  const [sel, setSel] = useState<number | null>(null);
  const [offers, setOffers] = useState<{ id: string; list: CheapOffer[]; count: number } | null>(null);
  const [drawer, setDrawer] = useState<null | 'add' | 'look'>(null);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const have = cards.filter((c) => c.owned > 0).length;
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

  useEffect(() => {
    if (!selCard || selCard.owned) { setOffers(null); return; }
    let alive = true;
    cardOffers(selCard.id).then((r) => { if (alive) setOffers({ id: selCard.id, list: r.offers, count: r.count }); });
    return () => { alive = false; };
  }, [selCard]);

  const apply = (next: AlbumCard[]) => { setCards(next); cardsRef.current = next; view.current?.setCards(next); };

  /** Uloží karty do sbírky a vloží je do alba s animací (1B jedna karta, 2B více karet). */
  const insert = (ids: string[], extra: AlbumCard[] = []) =>
    start(async () => {
      setErr('');
      const r = await addCards(ids, album.id);
      if ('error' in r) { setErr(r.error === 'login' ? 'Přihlaste se znovu.' : r.error); return; }
      const count = new Map<string, number>();
      ids.forEach((id) => count.set(id, (count.get(id) ?? 0) + 1));
      const base = [...cardsRef.current, ...extra.filter((e) => !cardsRef.current.some((c) => c.id === e.id))];
      const fresh: number[] = [];
      const next = base.map((c, i) => {
        const n = count.get(c.id);
        if (!n) return c;
        if (!c.owned) fresh.push(i);
        return { ...c, owned: c.owned + n };
      });
      apply(next);
      setSel(null);
      setDrawer(null);
      if (fresh.length) await view.current?.play(fresh);
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
      <div className={s.crumb}><Link href="/kolekce">Moje kolekce</Link><span>›</span><span>{look.name}</span></div>
      <div className={s.ahead}>
        <div className={s.atitle}>
          <AlbumBook design={look.design} name={look.name} scale={0.3} />
          <div>
            <h1>{look.name}</h1>
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
          <Button variant="secondary" onClick={() => setDrawer('look')}>Vzhled alba</Button>
          <Button onClick={() => setDrawer('add')}>＋ Přidat karty</Button>
        </div>
      </div>

      <div className={s.full}>
        <div className={s.stage}>
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
            <Button disabled={pending} onClick={() => insert([selCard.id])}>✓ Mám ji, vložit do alba</Button>
            {selCard.offers ? (
              <ButtonLink variant="secondary" href={`/karty/${selCard.slug}`}>
                Zobrazit {selCard.offers} {selCard.offers === 1 ? 'nabídku' : selCard.offers <= 4 ? 'nabídky' : 'nabídek'}
              </ButtonLink>
            ) : <ButtonLink variant="secondary" href={`/karty/${selCard.slug}`}>Detail karty</ButtonLink>}
            <WatchButton cardId={selCard.id} size="md" />
          </div>
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

/** Přidat karty (2B): u alba sady chybějící karty, u vlastního alba hledání v katalogu. */
function AddDrawer({ album, cards, pending, onClose, onAdd }: {
  album: AlbumDetail; cards: AlbumCard[]; pending: boolean; onClose: () => void; onAdd: (ids: string[], extra?: AlbumCard[]) => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Map<string, number>>(new Map());
  const [found, setFound] = useState<PickCard[]>([]);
  const [loading, setLoading] = useState(false);
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

  const list = useMemo(() => {
    if (album.kind === 'custom') return found.map((c) => ({ id: c.id, name: c.name, number: c.number, image: c.image, have: c.owned }));
    const needle = q.trim().toLocaleLowerCase('cs');
    return cards.filter((c) => !c.owned && (!needle || c.name.toLocaleLowerCase('cs').includes(needle) || c.number.toLowerCase().startsWith(needle)))
      .map((c) => ({ id: c.id, name: c.name, number: c.number, image: c.image }));
  }, [album.kind, cards, found, q]);

  const total = [...picked.values()].reduce((a, b) => a + b, 0);
  const submit = () => {
    const ids: string[] = [];
    picked.forEach((n, id) => { for (let i = 0; i < n; i++) ids.push(id); });
    const extra: AlbumCard[] = album.kind === 'custom'
      ? [...picked.keys()].map((id) => known.current.get(id)).filter((c): c is PickCard => !!c).map((c) => ({
        id: c.id, slug: c.slug, name: c.name, number: c.number, rarity: c.rarity, image: c.image, setName: c.setName,
        game: album.game ?? 'pokemon', owned: 0, minPrice: c.minPrice ?? null, offers: 0,
      }))
      : [];
    onAdd(ids, extra);
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
      <p className={s.hint}>
        {album.kind === 'custom'
          ? 'Karty se přidají na konec alba. Dvojklik přidá další kus.'
          : `Chybí ${cards.filter((c) => !c.owned).length} karet. Tažením přes karty označíš víc najednou, dvojklik přidá další kus.`}
      </p>
      {loading ? <p className={s.hint}>Hledám…</p> : null}
      <CardPicker cards={list} value={picked} onChange={setPicked} />
      {album.kind === 'set' && !list.length ? <p className={s.hint}>{q ? 'Nic nenalezeno.' : 'Album je kompletní.'}</p> : null}
    </Drawer>
  );
}
