import type { FlowAction } from '@/lib/order-flow';

/** Ikona vedlejší akce (DS Messages › Tlačítka v bublinách): křížek u zrušení a odmítnutí, šipka zpět u stažení. */
export function ActionIcon({ kind }: { kind: 'x' | 'undo' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', display: 'block', opacity: 0.7 }}>
      {kind === 'x' ? <path d="M7 7l10 10M17 7 7 17" /> : <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>}
    </svg>
  );
}

/** Zrušit, Odmítnout a Zrušit objednávku mají křížek. */
export function isDismiss(a: FlowAction): boolean {
  return a.op === 'ship_reject' || (a.op === 'status' && (a.status === 'cancelled' || a.status === 'declined'));
}
