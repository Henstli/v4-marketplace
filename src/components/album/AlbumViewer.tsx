'use client';

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { albumDesign, sleeveDesign } from '@/lib/album/designs';
import { AlbumEngine, type EngineCard } from './engine';
import { SleeveSprite } from './SleeveSprite';
import './album.css';

export interface AlbumHandle {
  play: (indices: number[], opts?: { founding?: boolean; title?: string }) => Promise<void>;
  setCards: (cards: EngineCard[]) => void;
  showCard: (index: number, select?: boolean) => Promise<void>;
  select: (index: number | null) => void;
  rename: (name: string) => void;
}

interface Props {
  name: string;
  design: number;
  sleeve: number;
  cards: EngineCard[];
  open?: boolean;
  /** Počítadlo „máš / celkem“ (album sady) */
  counterTotal?: boolean;
  onEmpty?: (card: EngineCard, index: number) => void;
  onRemove?: (card: EngineCard, index: number) => void;
  ref?: Ref<AlbumHandle>;
}

/** Otevřené album (3A/3B). Vzhled se mění jen novým klíčem (key) komponenty. */
export function AlbumViewer({ name, design, sleeve, cards, open, counterTotal, onEmpty, onRemove, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const eng = useRef<AlbumEngine | null>(null);
  const cb = useRef(onEmpty);
  cb.current = onEmpty;
  const rm = useRef(onRemove);
  rm.current = onRemove;
  const cur = useRef(cards);
  cur.current = cards;
  const first = useRef({ open, counterTotal });
  const nm = useRef(name);
  nm.current = name;

  useEffect(() => {
    const e = new AlbumEngine(host.current!, {
      cards: cur.current, name: nm.current, open: first.current.open, counterTotal: first.current.counterTotal,
      design: albumDesign(design), sleeve: sleeveDesign(sleeve),
      onEmpty: (c, i) => cb.current?.(c, i),
      onRemove: onRemove ? (c, i) => rm.current?.(c, i) : undefined,
    });
    eng.current = e;
    return () => { e.destroy(); eng.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, sleeve]);

  useImperativeHandle(ref, () => ({
    play: (i, o) => eng.current?.play(i, o) ?? Promise.resolve(),
    setCards: (c) => eng.current?.setCards(c),
    showCard: (i, s) => eng.current?.showCard(i, s) ?? Promise.resolve(),
    select: (i) => eng.current?.select(i),
    rename: (n) => eng.current?.rename(n),
  }), []);

  return (
    <>
      <SleeveSprite />
      <div ref={host} className="alb" />
    </>
  );
}
