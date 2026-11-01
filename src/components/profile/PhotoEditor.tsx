'use client';

// Nahrání profilovky (DS Trezor › ProfileCard › Profilovka, deska AV, editor varianta 1 „Rohové značky“):
// z jedné fotky banner na kartě a kruh všude v malém. Obdélník = banner (tažením posun, kterýmkoli rohem zvětšení),
// kruh = profilovka uvnitř banneru (tažením posun, tažením za okraj velikost). Okolí kruhu je v banneru jemně ztmavené.
import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { BANNER_AR, bannerH, maxBannerW, type PhotoCrop } from '@/lib/profile-card';

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Mode = 'rect' | 'circ' | 'edge' | Corner;
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];
const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const MIN_ZOOM = 0.25; // nejmenší banner = čtvrtina největšího
const EDGE = 9; // jak daleko od okraje kruhu (px) se chytá změna velikosti

interface Drag { mode: Mode; px: number; py: number; c: PhotoCrop; W: number; H: number; ox: number; oy: number; d0: number }

export function PhotoEditor({ src, crop, onCrop }: { src: string; crop: PhotoCrop; onCrop: (c: PhotoCrop) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [hoverEdge, setHoverEdge] = useState(false);
  const maxW = maxBannerW(crop.a);
  const h = bannerH(crop);

  // Střed a poloměr kruhu na obrazovce; okraj kruhu (±EDGE px) mění velikost
  const ring = (e: PointerEvent<HTMLDivElement>) => {
    const b = stage.current!.getBoundingClientRect();
    const W = b.width, H = b.height;
    const ox = b.left + (crop.x + crop.cx * crop.w) * W;
    const oy = b.top + (crop.y + crop.cy * h) * H;
    const d = Math.hypot(e.clientX - ox, e.clientY - oy);
    return { W, H, ox, oy, d, onEdge: Math.abs(d - crop.r * crop.w * W * BANNER_AR) <= EDGE };
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    let part = (e.target as HTMLElement).closest('[data-part]')?.getAttribute('data-part') as Mode | null;
    if (!part || !stage.current) return;
    e.preventDefault();
    const g = ring(e);
    if ((part === 'rect' || part === 'circ') && g.onEdge) part = 'edge';
    drag.current = { mode: part, px: e.clientX, py: e.clientY, c: crop, W: g.W, H: g.H, ox: g.ox, oy: g.oy, d0: g.d };
    stage.current.setPointerCapture(e.pointerId);
    setMode(part);
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) {
      const part = (e.target as HTMLElement).closest('[data-part]')?.getAttribute('data-part');
      const edge = (part === 'rect' || part === 'circ') && ring(e).onEdge;
      if (edge !== hoverEdge) setHoverEdge(edge);
      return;
    }
    const { c, W, H } = d;
    const dx = e.clientX - d.px, dy = e.clientY - d.py;
    const bw = c.w * W, bh = bw * BANNER_AR, ch0 = bannerH(c);
    if (d.mode === 'rect') {
      onCrop({ ...c, x: cl(c.x + dx / W, 0, 1 - c.w), y: cl(c.y + dy / H, 0, 1 - ch0) });
    } else if (d.mode === 'circ') {
      const rp = c.r * bh;
      onCrop({ ...c, cx: cl(c.cx * bw + dx, rp, bw - rp) / bw, cy: cl(c.cy * bh + dy, rp, bh - rp) / bh });
    } else if (d.mode === 'edge') {
      const rp = cl(c.r * bh + Math.hypot(e.clientX - d.ox, e.clientY - d.oy) - d.d0, bh * 0.15, bh * 0.5);
      onCrop({ ...c, r: rp / bh, cx: cl(c.cx * bw, rp, bw - rp) / bw, cy: cl(c.cy * bh, rp, bh - rp) / bh });
    } else {
      // Roh: protější roh zůstává na místě
      const right = d.mode === 'tr' || d.mode === 'br', bottom = d.mode === 'bl' || d.mode === 'br';
      const grow = Math.max((right ? dx : -dx), (bottom ? dy : -dy) / BANNER_AR) / W;
      const roomX = right ? 1 - c.x : c.x + c.w;
      const roomY = ((bottom ? 1 - c.y : c.y + ch0) * c.a) / BANNER_AR;
      const w = cl(c.w + grow, maxW * MIN_ZOOM, Math.min(roomX, roomY, maxW));
      const nh = bannerH({ a: c.a, w });
      onCrop({ ...c, w, x: right ? c.x : c.x + c.w - w, y: bottom ? c.y : c.y + ch0 - nh });
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
  const zoomV = Math.round(((maxW - crop.w) / (maxW * (1 - MIN_ZOOM))) * 100);
  const sizeV = Math.round(((crop.r - 0.15) / 0.35) * 100);
  return (
    <div className="tz-photo-editor">
      <div ref={stage} className="tz-photo-stage" style={{ width: `min(100%, ${Math.round(560 / crop.a)}px)` }} data-drag={mode ?? undefined} data-edge={hoverEdge && !mode ? '' : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Nahraná fotka" draggable={false} />
        <div className="tz-photo-rect" data-part="rect" style={{ left: pc(crop.x), top: pc(crop.y), width: pc(crop.w), height: pc(h) }}>
          <div className="tz-photo-inner">
            <i className="tz-photo-grid" aria-hidden="true" />
            <div className="tz-photo-circle" data-part="circ" style={{ left: pc(crop.cx - cw / 2), top: pc(crop.cy - chh / 2), width: pc(cw), height: pc(chh) }} />
          </div>
          <span className="tz-photo-tag">Banner karty</span>
          {CORNERS.map((k) => <i key={k} className="tz-photo-corner" data-part={k} data-c={k} aria-hidden="true" />)}
        </div>
      </div>
      <div className="tz-photo-sliders">
        <Slider label="PŘIBLÍŽENÍ BANNERU" value={zoomV} onChange={zoom} small={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M20 20l-4-4" /></svg>} big={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M20 20l-4-4" /></svg>} />
        <Slider label="VELIKOST KRUHU" value={sizeV} onChange={size} small={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="9" /></svg>} big={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>} />
      </div>
    </div>
  );
}

function Slider({ label, value, onChange, small, big }: { label: string; value: number; onChange: (v: number) => void; small: ReactNode; big: ReactNode }) {
  return (
    <label className="tz-photo-slider">
      <span className="t-label muted">{label}</span>
      <span className="tz-photo-slider-row">
        <span className="tz-photo-slider-ico" aria-hidden="true">{small}</span>
        <input type="range" min={0} max={100} value={value} aria-label={label} style={{ '--p': `${value}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="tz-photo-slider-ico" aria-hidden="true">{big}</span>
      </span>
    </label>
  );
}
