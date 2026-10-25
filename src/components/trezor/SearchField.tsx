import type { InputHTMLAttributes, Ref } from 'react';
import { cx } from './cx';

export interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Klávesová zkratka zobrazená vpravo, např. "/" */
  shortcut?: string;
  label?: string;
  ref?: Ref<HTMLInputElement>;
}

export function SearchField({ shortcut, className, label = 'Hledat', ...rest }: SearchFieldProps) {
  return (
    <label className={cx('tz-search', className)}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <circle cx={11} cy={11} r={7} />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input type="search" aria-label={label} {...rest} />
      {shortcut ? <span className="tz-kbd" aria-hidden="true">{shortcut}</span> : null}
    </label>
  );
}
