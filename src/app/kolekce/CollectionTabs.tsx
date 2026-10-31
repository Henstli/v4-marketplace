'use client';

import { useEffect, useState } from 'react';
import s from './kolekce.module.css';

export type CollectionTab = 'alba' | 'karty' | 'chybi';

/** Záložky Kolekce: obsah všech tří přijde ze serveru naráz, přepnutí je okamžité (jen se změní adresa). */
export function CollectionTabs({ initial, counts, panels }: {
  initial: CollectionTab;
  counts: Record<CollectionTab, string>;
  panels: Record<CollectionTab, React.ReactNode>;
}) {
  const [tab, setTab] = useState<CollectionTab>(initial);
  const go = (t: CollectionTab) => {
    setTab(t);
    const url = t === 'alba' ? '/kolekce' : `/kolekce?tab=${t}`;
    window.history.replaceState(window.history.state, '', url);
  };
  // odkazy uvnitř záložek (např. „Všechny chybějící →“) přepnou záložku bez načítání
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      go(a.dataset.tab as CollectionTab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    document.addEventListener('click', on);
    return () => document.removeEventListener('click', on);
  }, []);
  const names: Record<CollectionTab, string> = { alba: 'Alba', karty: 'Všechny karty', chybi: 'Chybějící' };
  return (
    <>
      <nav className={s.tabs} aria-label="Části kolekce">
        {(Object.keys(names) as CollectionTab[]).map((t) => (
          <a key={t} className={s.tab} href={t === 'alba' ? '/kolekce' : `/kolekce?tab=${t}`} aria-current={tab === t ? 'page' : undefined}
            onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); go(t); }}>
            {names[t]}<small>{counts[t]}</small>
          </a>
        ))}
      </nav>
      {(Object.keys(names) as CollectionTab[]).map((t) => <div key={t} hidden={tab !== t}>{panels[t]}</div>)}
    </>
  );
}
