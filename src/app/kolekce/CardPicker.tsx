'use client';

import { useRef } from 'react';
import { thumbUrl } from '@/lib/images';
import s from './kolekce.module.css';

export interface PickItem {
  id: string;
  name: string;
  number: string;
  image: string | null;
  /** Kolik kusů už je ve sbírce (jen popisek) */
  have?: number;
}

/**
 * Mřížka karet k označení (5C): klik označí nebo zruší, tažením přes karty se označí víc najednou,
 * dvojklik přidá další kus. value = počet kusů k vložení.
 */
export function CardPicker({ cards, value, onChange }: { cards: PickItem[]; value: Map<string, number>; onChange: (v: Map<string, number>) => void }) {
  const paint = useRef<{ on: boolean; moved: boolean; start: string } | null>(null);
  const cur = useRef(value);
  cur.current = value;

  const set = (id: string, n: number) => {
    const m = new Map(cur.current);
    if (n > 0) m.set(id, n); else m.delete(id);
    cur.current = m;
    onChange(m);
  };

  return (
    <div
      className={s.pick}
      onPointerUp={() => { paint.current = null; }}
      onPointerLeave={() => { paint.current = null; }}
    >
      {cards.map((c) => {
        const n = value.get(c.id) ?? 0;
        const src = c.image ? thumbUrl(c.image) ?? c.image : null;
        return (
          <button
            key={c.id}
            type="button"
            className={`${s.pc} ${n ? s.on : ''}`}
            aria-pressed={n > 0}
            title={`${c.name} · #${c.number}`}
            onPointerDown={(e) => {
              if (e.button) return;
              (e.currentTarget.parentElement as HTMLElement).releasePointerCapture?.(e.pointerId);
              e.currentTarget.releasePointerCapture?.(e.pointerId);
              const on = !n;
              paint.current = { on, moved: false, start: c.id };
              set(c.id, on ? 1 : 0);
            }}
            onPointerEnter={() => {
              const p = paint.current;
              if (!p) return;
              p.moved = true;
              set(c.id, p.on ? Math.max(1, cur.current.get(c.id) ?? 0) : 0);
            }}
            onDoubleClick={() => set(c.id, Math.min(99, Math.max(1, n) + 1))}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set(c.id, n ? 0 : 1); } }}
          >
            <div className={s.mcImg}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : null}
              <span className={s.num}>#{c.number}</span>
            </div>
            <span className={s.ck} aria-hidden="true">✓</span>
            {n > 1 ? <span className={s.cnt}>×{n}</span> : null}
            <small>{c.have ? `máš ${c.have} · ` : ''}{c.name}</small>
          </button>
        );
      })}
    </div>
  );
}
