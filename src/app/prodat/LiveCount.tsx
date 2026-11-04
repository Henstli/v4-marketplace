'use client';

import { useSyncExternalStore } from 'react';
import { liveCounts } from './stock-view';
import { nf } from './sk';

/** Počet v záložce Všechny karty / Na prodej: po úpravě v tabulce se obnoví bez nového načtení stránky. */
export function LiveCount({ k, n, id }: { k: 'vse' | 'prodej'; n: number; id: string }) {
  const c = useSyncExternalStore(liveCounts.sub, liveCounts.get, () => null);
  return <span className="n">{nf(c?.id === id ? c[k] : n)}</span>;
}
