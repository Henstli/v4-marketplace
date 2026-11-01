'use client';

// Alba na hrací podložce (DS Trezor › ProfileMat, deska P5): police, která plynule ujede do strany.
import Link from 'next/link';
import { useState } from 'react';
import { AlbumBook } from '@/components/album/AlbumBook';
import type { ShowcaseAlbum } from '@/lib/profile';

export function MatAlbums({ albums, own }: { albums: ShowcaseAlbum[]; own: boolean }) {
  const [i, setI] = useState(0);
  const n = albums.length;
  const a = albums[i];
  const go = (d: number) => setI((v) => (v + d + n) % n);
  const pct = a.total ? Math.round((a.have / a.total) * 100) : 0;
  return (
    <>
      <div className="tz-mat-albums">
        <div className="tz-mat-shelf" aria-hidden="true">
          <div className="tz-mat-track" style={{ transform: `translateX(${-i * 130}px)` }}>
            {albums.map((x) => <div key={x.id}><AlbumBook design={x.design} name={x.name} scale={0.6} /></div>)}
          </div>
        </div>
        <div className="tz-mat-ainfo" aria-live="polite">
          <h3 title={a.name}>{a.name}</h3>
          <span className="tz-mat-sub">{a.kind === 'set' ? a.setName ?? 'Album sady' : 'Vlastní album'}</span>
          <div className="tz-mat-bar" title={`${pct} %`}><i><b style={{ width: `${pct}%` }} /></i><span>{a.have} / {a.total}</span></div>
          {own ? <Link href={`/kolekce/${a.id}`} className="tz-btn tz-btn-sm tz-mat-ghost" style={{ alignSelf: 'flex-start' }}>Otevřít album</Link> : null}
          {n > 1 ? (
            <div className="tz-mat-pager">
              <button type="button" className="tz-mat-arrow" onClick={() => go(-1)} aria-label="Předchozí album">‹</button>
              <span>{i + 1} / {n}</span>
              <button type="button" className="tz-mat-arrow" onClick={() => go(1)} aria-label="Další album">›</button>
            </div>
          ) : null}
        </div>
      </div>
      {n > 1 ? <div className="tz-mat-dots" aria-hidden="true">{albums.map((x, k) => <i key={x.id} data-on={k === i ? '' : undefined} />)}</div> : null}
    </>
  );
}
