'use client';

import { useEffect } from 'react';
import { SLEEVE_SPRITE } from '@/lib/album/designs';

// Vzory obalů (symboly s1–s20) se vloží do stránky jednou, obaly pak jen odkazují <use href="#sN">.
// Skryté SVG nesmí mít display:none, jinak by se nevykreslily přechody.
let loading: Promise<void> | null = null;

export function SleeveSprite() {
  useEffect(() => {
    if (document.getElementById('v4-sleeves') || loading) return;
    loading = fetch(SLEEVE_SPRITE).then((r) => r.text()).then((svg) => {
      if (document.getElementById('v4-sleeves')) return;
      const box = document.createElement('div');
      box.id = 'v4-sleeves';
      box.setAttribute('aria-hidden', 'true');
      box.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      box.innerHTML = svg;
      const el = box.firstElementChild as SVGElement | null;
      if (el) { el.setAttribute('width', '0'); el.setAttribute('height', '0'); }
      document.body.appendChild(box);
    }).catch(() => { loading = null; });
  }, []);
  return null;
}
