import type { FlowAction } from '@/lib/order-flow';

/** Ikona vedlejší akce (DS Messages › Tlačítka v bublinách): křížek u zrušení a odmítnutí, šipka zpět u stažení. */
export function ActionIcon({ kind }: { kind: 'x' | 'undo' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'x' ? <path d="M6 6l12 12M18 6 6 18" /> : <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>}
    </svg>
  );
}

/** Zrušit, Odmítnout a Zrušit objednávku mají křížek. */
export function isDismiss(a: FlowAction): boolean {
  return a.op === 'ship_reject' || (a.op === 'status' && (a.status === 'cancelled' || a.status === 'declined'));
}
