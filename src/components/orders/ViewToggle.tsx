'use client';

import { useEffect, useState } from 'react';

const KEY = 'v4-ord-view';
type View = 'thumbs' | 'text';

export const VIEW_ICONS = {
  thumbs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="6" height="8" rx="1" /><path d="M12 6h9M12 10h6" /><rect x="3" y="14" width="6" height="7" rx="1" /><path d="M12 16h9M12 20h6" /></svg>
  ),
  text: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
  ),
};

/**
 * Přepínač S náhledy / Jen text (DS Orders, ikona varianta 1). Nastaví `data-view` na prvku `target`
 * a volbu si pamatuje prohlížeč, společně pro seznam i detail.
 */
export function ViewToggle({ target }: { target: string }) {
  const [view, setView] = useState<View>('thumbs');
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch {}
    if (saved === 'text') setView('text');
  }, []);
  useEffect(() => {
    const el = document.getElementById(target);
    if (el) {
      if (view === 'text') el.dataset.view = 'text';
      else delete el.dataset.view;
    }
  }, [view, target]);
  const pick = (v: View) => {
    setView(v);
    try { localStorage.setItem(KEY, v); } catch {}
  };
  return (
    <span className="tz-ord-view" role="group" aria-label="Zobrazení">
      <button type="button" aria-pressed={view === 'thumbs'} title="S náhledy" aria-label="S náhledy" onClick={() => pick('thumbs')}>{VIEW_ICONS.thumbs}</button>
      <button type="button" aria-pressed={view === 'text'} title="Jen text" aria-label="Jen text" onClick={() => pick('text')}>{VIEW_ICONS.text}</button>
    </span>
  );
}
