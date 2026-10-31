'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { Button, Chip, SearchField } from '@/components/trezor';
import { compareCardNumbers } from '@/lib/album/designs';
import type { AlbumCard } from '@/lib/collection';
import { formatNumber } from '@/lib/format';
import { CardItem } from './CardItem';
import s from './kolekce.module.css';

type Card = AlbumCard & { albumId?: string };
type Sort = 'recent' | 'offer' | 'cheap' | 'expensive' | 'number' | 'name';

const SORTS: Record<'all' | 'missing', Array<[Sort, string]>> = {
  all: [['recent', 'naposledy přidané'], ['number', 'podle sady a čísla'], ['name', 'podle názvu'], ['expensive', 'nejdražší']],
  missing: [['offer', 'v nabídce nahoře'], ['cheap', 'nejlevnější'], ['number', 'podle sady a čísla'], ['name', 'podle názvu']],
};
const STEP = 120;

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cardsWord = (n: number) => (n === 1 ? 'karta' : n >= 2 && n <= 4 ? 'karty' : 'karet');

/**
 * Hledání, výběr alba a řazení pro Všechny karty a Chybějící (varianta A).
 * Chybějící mají navíc „Jen v nabídce“. Filtruje se v prohlížeči přes všechny karty.
 */
export function CardsBrowser({ cards, albums, cardAlbums, missing }: {
  cards: Card[];
  albums: Array<{ id: string; name: string }>;
  /** karta → alba, ve kterých je (u chybějících je album přímo u karty) */
  cardAlbums?: Record<string, string[]>;
  missing?: boolean;
}) {
  const [q, setQ] = useState('');
  const [album, setAlbum] = useState('');
  const [sort, setSort] = useState<Sort>(missing ? 'offer' : 'recent');
  const [offered, setOffered] = useState(false);
  const [shown, setShown] = useState(STEP);
  const dq = useDeferredValue(q);
  const offeredCount = useMemo(() => cards.filter((c) => c.offers > 0).length, [cards]);

  const list = useMemo(() => {
    const words = norm(dq).split(/\s+/).filter(Boolean);
    let out = cards.filter((c) => {
      if (album && (missing ? c.albumId !== album : !cardAlbums?.[c.id]?.includes(album))) return false;
      if (offered && !c.offers) return false;
      if (!words.length) return true;
      const hay = norm(`${c.name} ${c.number} ${c.setName}`);
      return words.every((w) => hay.includes(w));
    });
    const bySet = (a: Card, b: Card) => a.setName.localeCompare(b.setName, 'cs') || compareCardNumbers(a.number, b.number);
    if (sort === 'number') out = [...out].sort(bySet);
    else if (sort === 'name') out = [...out].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    else if (sort === 'cheap') out = [...out].sort((a, b) => (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity));
    else if (sort === 'expensive') out = [...out].sort((a, b) => (b.minPrice ?? -1) - (a.minPrice ?? -1));
    else if (sort === 'offer') out = [...out].sort((a, b) => (b.offers ? 1 : 0) - (a.offers ? 1 : 0));
    return out;
  }, [cards, cardAlbums, dq, album, offered, sort, missing]);

  const reset = () => setShown(STEP);
  const filtered = !!(dq.trim() || album || offered);
  const total = cards.length;

  return (
    <>
      <div className={s.tools}>
        <SearchField className={s.toolSearch} placeholder="Hledat kartu nebo číslo" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
        <select className={s.select} value={album} onChange={(e) => { setAlbum(e.target.value); reset(); }} aria-label="Album">
          <option value="">Všechna alba</option>
          {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className={s.select} value={sort} onChange={(e) => { setSort(e.target.value as Sort); reset(); }} aria-label="Řazení">
          {SORTS[missing ? 'missing' : 'all'].map(([v, l]) => <option key={v} value={v}>Řadit: {l}</option>)}
        </select>
        {missing ? (
          <Chip className={s.toolChip} selected={offered} onClick={() => { setOffered(!offered); reset(); }}>
            {offered ? '✓ ' : ''}Jen v nabídce<small>{formatNumber(offeredCount)}</small>
          </Chip>
        ) : null}
      </div>
      <p className={s.hint} style={{ margin: 'var(--space-3) 0 0' }}>
        {filtered
          ? `${formatNumber(list.length)} z ${formatNumber(total)} ${missing ? 'chybějících karet' : cardsWord(total)}`
          : `${formatNumber(total)} ${missing ? (total === 1 ? 'chybějící karta' : total <= 4 ? 'chybějící karty' : 'chybějících karet') : cardsWord(total)}`}
      </p>
      {list.length ? (
        <div className={s.cards}>{list.slice(0, shown).map((c) => <CardItem key={`${c.albumId ?? ''}-${c.id}`} c={c} missing={missing} />)}</div>
      ) : (
        <p className={s.none}>Žádná karta neodpovídá. Zkus jiné hledání nebo album.</p>
      )}
      {list.length > shown ? (
        <div className={s.more}><Button variant="secondary" onClick={() => setShown(shown + STEP)}>Zobrazit dalších {formatNumber(Math.min(STEP, list.length - shown))}</Button></div>
      ) : null}
    </>
  );
}
