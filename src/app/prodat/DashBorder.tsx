'use client';

import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Čárkovaný okraj se stejně dlouhými čárkami všude, i v rozích: v každém rohu je čárka vystředěná na oblouk
 * a na každé straně mezi nimi rovnoměrně rozložené další (CSS border dashed se láme podle velikosti a zvětšení).
 * Dává se dovnitř prvku s position: relative; barvu bere z CSS (.dash path { stroke }).
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
  let arr = '';
  if (box && box.w > 2 * r && box.h > 2 * r) {
    const a = 0.5, R = r - a, x1 = box.w - a, y1 = box.h - a;
    const k = R * (1 - Math.SQRT1_2); // střed oblouku (45°) od rohu
    const q = (Math.PI * R) / 2; // délka oblouku rohu
    const W = x1 - a - 2 * R, H = y1 - a - 2 * R;
    // Cesta začíná ve středu levého horního oblouku a jde po směru hodinových ručiček.
    d = `M${a + k} ${a + k}A${R} ${R} 0 0 1 ${a + R} ${a}H${x1 - R}A${R} ${R} 0 0 1 ${x1} ${a + R}`
      + `V${y1 - R}A${R} ${R} 0 0 1 ${x1 - R} ${y1}H${a + R}A${R} ${R} 0 0 1 ${a} ${y1 - R}`
      + `V${a + R}A${R} ${R} 0 0 1 ${a + k} ${a + k}`;
    // Úseky mezi středy rohů: čárky vystředěné na koncích i uvnitř, všechny stejně dlouhé.
    const parts: number[] = [dash / 2];
    for (const S of [W + q, H + q, W + q, H + q]) {
      const n = Math.max(1, Math.round(S / (dash + gap)));
      const p = S / n;
      for (let i = 0; i < n; i++) parts.push(p - dash, dash);
    }
    parts[parts.length - 1] = dash / 2;
    arr = parts.map((x) => x.toFixed(3)).join(' ');
  }
  return (
    <svg ref={ref} className="dash" aria-hidden="true" width={box?.w ?? 0} height={box?.h ?? 0}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      <path d={d} fill="none" strokeWidth="1" strokeDasharray={arr || undefined} />
    </svg>
  );
}
