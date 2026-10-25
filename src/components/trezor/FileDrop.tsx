'use client';

import { useState } from 'react';
import { cx } from './cx';

export interface FileDropProps {
  /** Typy souborů pro výběr, např. ".csv,.xlsx" */
  accept?: string;
  title?: string;
  /** Drobný text pod ním: jaké soubory plocha bere */
  hint?: string;
  /** Název vybraného souboru; zobrazí se místo nápovědy */
  fileName?: string;
  onFile?: (file: File) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

// Plocha pro nahrání souboru: klik otevře výběr souboru, soubor jde i přetáhnout.
export function FileDrop({ accept, title, hint, fileName, onFile, disabled, label = 'Vybrat soubor', className }: FileDropProps) {
  const [over, setOver] = useState(false);
  const take = (files: FileList | null) => {
    if (files?.[0] && onFile) onFile(files[0]);
  };
  return (
    <label
      className={cx('tz-drop', over ? 'tz-drop-over' : null, className)}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
    >
      <svg className="tz-drop-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
      </svg>
      <span className="tz-drop-title">{title ?? 'Přetáhněte soubor sem nebo klikněte a vyberte ho'}</span>
      {fileName ? <span className="tz-drop-file">{fileName}</span> : hint ? <span>{hint}</span> : null}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
      />
    </label>
  );
}
