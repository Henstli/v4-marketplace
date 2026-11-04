'use client';

import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Čárkovaný okraj, který vypadá všude stejně: plné rohy a na každé straně rovnoměrně rozložené čárky,
 * které začínají i končí v rohu (CSS border dashed se láme podle velikosti a zvětšení stránky).
 * Dává se dovnitř prvku s position: relative; barvu bere z CSS (.dash { stroke }).
 */
export function DashBorder({ r = 10, dash = 4, gap = 4 }: { r?: number; dash?: number; gap?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  let d = '';
  if (box && box.w > 2 * r && box.h > 2 * r) {
    const { w, h } = box;
    const a = 0.5, R = r - a, x1 = w - a, y1 = h - a;
    // Rovné strany: čárky od rohu k rohu, mezery dopočítané, aby vyšly přesně.
    const side = (sx: number, sy: number, ex: number, ey: number) => {
      const L = Math.hypot(ex - sx, ey - sy);
      const n = Math.max(2, Math.round((L + gap) / (dash + gap)));
      const g = (L - n * dash) / (n - 1);
      const ux = (ex - sx) / L, uy = (ey - sy) / L;
      let out = '';
      for (let k = 0; k < n; k++) {
        const s = k * (dash + g), e = s + dash;
        out += `M${(sx + ux * s).toFixed(2)} ${(sy + uy * s).toFixed(2)}L${(sx + ux * e).toFixed(2)} ${(sy + uy * e).toFixed(2)}`;
      }
      return out;
    };
    // Rohy plné, s krátkým přesahem do strany (jako první a poslední čárka).
    const corners = `M${a} ${a + R}A${R} ${R} 0 0 1 ${a + R} ${a}`
      + `M${x1 - R} ${a}A${R} ${R} 0 0 1 ${x1} ${a + R}`
      + `M${x1} ${y1 - R}A${R} ${R} 0 0 1 ${x1 - R} ${y1}`
      + `M${a + R} ${y1}A${R} ${R} 0 0 1 ${a} ${y1 - R}`;
    d = corners
      + side(a + R, a, x1 - R, a) + side(x1, a + R, x1, y1 - R)
      + side(x1 - R, y1, a + R, y1) + side(a, y1 - R, a, a + R);
  }
  return (
    <svg ref={ref} className="dash" aria-hidden="true" width={box?.w ?? 0} height={box?.h ?? 0}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      <path d={d} fill="none" strokeWidth="1" />
    </svg>
  );
}
