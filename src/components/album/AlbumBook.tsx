'use client';

import { useLayoutEffect, useRef } from 'react';
import { albumDesign, sleeveDesign } from '@/lib/album/designs';
import { coverHTML, fitCoverNames, sleeveHTML } from './engine';
import './album.css';

/** Zavřené album naplocho podle desky Design album (police, výběr vzhledu). scale zmenší album 168 × 210. */
export function AlbumBook({ design, name, scale = 1, lift, hover }: { design: number; name: string; scale?: number; lift?: boolean; hover?: boolean }) {
  const d = albumDesign(design);
  const ref = useRef<HTMLDivElement>(null);
  const html = `<div class="bk">${coverHTML(d, name)}</div>`;
  useLayoutEffect(() => {
    if (!ref.current) return;
    fitCoverNames(ref.current);
    document.fonts?.ready.then(() => { if (ref.current) fitCoverNames(ref.current); });
  }, [html]);
  return (
    <div className="ab-mini" style={{ width: 168 * scale, height: 210 * scale }}>
      <div
        ref={ref}
        className={`ab3${lift ? ' lift' : ''}${hover ? ' hov' : ''}`}
        style={{ transform: scale !== 1 ? `scale(${scale})` : undefined }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/** Obal s kartou (150 × 206, scale zmenší). */
export function Sleeve({ sleeve, image, alt = '', scale = 1 }: { sleeve: number; image: string | null; alt?: string; scale?: number }) {
  return (
    <div style={{ width: 150 * scale, height: 206 * scale, position: 'relative', flex: 'none' }}>
      <div
        style={{ position: 'absolute', left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }}
        dangerouslySetInnerHTML={{ __html: sleeveHTML(sleeveDesign(sleeve), image, alt) }}
      />
    </div>
  );
}
