import { cx } from './cx';

export interface StepsProps {
  /** Názvy kroků, např. ["Soubor", "Sloupce", "Kontrola", "Hotovo"] */
  steps: string[];
  /** Index aktuálního kroku od 0; kroky před ním jsou hotové */
  current: number;
  label?: string;
  className?: string;
}

// Kroky průvodce: hotové kroky mají fajfku, aktuální je zvýrazněný. Nejsou to odkazy.
export function Steps({ steps, current, label = 'Postup', className }: StepsProps) {
  return (
    <ol className={cx('tz-steps', className)} aria-label={label}>
      {steps.map((s, i) => (
        <li key={s} className={cx('tz-step', i < current ? 'tz-step-done' : null)} aria-current={i === current ? 'step' : undefined}>
          <span className="tz-step-num" aria-hidden="true">{i < current ? '✓' : i + 1}</span>
          <span className="tz-step-label">{s}</span>
        </li>
      ))}
    </ol>
  );
}
