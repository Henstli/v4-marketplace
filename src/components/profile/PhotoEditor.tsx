'use client';

// Nahrání profilovky (DS Trezor › ProfileCard › Profilovka, deska AV): z jedné fotky banner na kartě a kruh všude v malém.
// Bílý obdélník = banner (tažením posun, rohem nebo posuvníkem zvětšení), čárkovaný kruh = profilovka uvnitř banneru.
import { useRef, useState, type PointerEvent } from 'react';
import { BANNER_AR, bannerH, maxBannerW, type PhotoCrop } from '@/lib/profile-card';

type Mode = 'rect' | 'rh' | 'circ' | 'ch';
const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const MIN_ZOOM = 0.25; // nejmenší banner = čtvrtina největšího

export function PhotoEditor({ src, crop, onCrop }: { src: string; crop: PhotoCrop; onCrop: (c: PhotoCrop) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; px: number; py: number; c: PhotoCrop; W: number; H: number } | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const maxW = maxBannerW(crop.a);
  const h = bannerH(crop);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    const part = (e.target as HTMLElement).closest('[data-part]')?.getAttribute('data-part') as Mode | null;
    if (!part || !stage.current) return;
    e.preventDefault();
    const b = stage.current.getBoundingClientRect();
    drag.current = { mode: part, px: e.clientX, py: e.clientY, c: crop, W: b.width, H: b.height };
    stage.current.setPointerCapture(e.pointerId);
    setMode(part);
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const { c, W, H } = d;
    const dx = e.clientX - d.px, dy = e.clientY - d.py;
    const bw = c.w * W, bh = bw * BANNER_AR;
    if (d.mode === 'rect') {
      onCrop({ ...c, x: cl(c.x + dx / W, 0, 1 - c.w), y: cl(c.y + dy / H, 0, 1 - bannerH(c)) });
    } else if (d.mode === 'rh') {
      const room = Math.min(1 - c.x, ((1 - c.y) * c.a) / BANNER_AR, maxW);
      onCrop({ ...c, w: cl(c.w + Math.max(dx, dy / BANNER_AR) / W, maxW * MIN_ZOOM, room) });
    } else if (d.mode === 'circ') {
      const rp = c.r * bh;
      onCrop({ ...c, cx: cl(c.cx * bw + dx, rp, bw - rp) / bw, cy: cl(c.cy * bh + dy, rp, bh - rp) / bh });
    } else {
      const rp = cl(c.r * bh + (dx - dy) / 2, bh * 0.15, bh * 0.5);
      onCrop({ ...c, r: rp / bh, cx: cl(c.cx * bw, rp, bw - rp) / bw, cy: cl(c.cy * bh, rp, bh - rp) / bh });
    }
  };

  const up = () => { drag.current = null; setMode(null); };

  const zoom = (v: number) => {
    const w = maxW - (v / 100) * maxW * (1 - MIN_ZOOM);
    const nh = bannerH({ a: crop.a, w });
    const mx = crop.x + crop.w / 2, my = crop.y + h / 2;
    onCrop({ ...crop, w, x: cl(mx - w / 2, 0, 1 - w), y: cl(my - nh / 2, 0, 1 - nh) });
  };
  const size = (v: number) => {
    const r = 0.15 + (v / 100) * 0.35;
    const rx = r * BANNER_AR;
    onCrop({ ...crop, r, cx: cl(crop.cx, rx, 1 - rx), cy: cl(crop.cy, r, 1 - r) });
  };

  const pc = (v: number) => `${v * 100}%`;
  // Kruh v procentech banneru: průměr = 2r výšky banneru, v šířce 2r × poměr stran
  const cw = 2 * crop.r * BANNER_AR, chh = 2 * crop.r;
  return (
    <div className="tz-photo-editor">
      <div ref={stage} className="tz-photo-stage" style={{ width: `min(100%, ${Math.round(560 / crop.a)}px)` }} data-drag={mode ? '' : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Nahraná fotka" draggable={false} />
        <div className="tz-photo-rect" data-part="rect" style={{ left: pc(crop.x), top: pc(crop.y), width: pc(crop.w), height: pc(h) }}>
          <span>BANNER KARTY</span>
          <div className="tz-photo-circle" data-part="circ" style={{ left: pc(crop.cx - cw / 2), top: pc(crop.cy - chh / 2), width: pc(cw), height: pc(chh) }}>
            <div className="tz-photo-handle" data-part="ch" aria-hidden="true" style={{ left: 'calc(85.36% - 12px)', top: 'calc(14.64% - 12px)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 18L18 6M12 6h6v6M6 12v6h6" /></svg>
            </div>
          </div>
          <div className="tz-photo-handle" data-part="rh" aria-hidden="true" style={{ right: -12, bottom: -12 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 18L18 6M12 6h6v6M6 12v6h6" /></svg>
          </div>
        </div>
      </div>
      <div className="tz-photo-sliders">
        <label>
          <span className="t-label muted">PŘIBLÍŽENÍ BANNERU</span>
          <input type="range" min={0} max={100} value={Math.round(((maxW - crop.w) / (maxW * (1 - MIN_ZOOM))) * 100)} onChange={(e) => zoom(Number(e.target.value))} />
        </label>
        <label>
          <span className="t-label muted">VELIKOST KRUHU</span>
          <input type="range" min={0} max={100} value={Math.round(((crop.r - 0.15) / 0.35) * 100)} onChange={(e) => size(Number(e.target.value))} />
        </label>
      </div>
    </div>
  );
}
