'use client';

import { useId } from 'react';
import { checkFile, MAX_FILES } from './upload';
import styles from './reports.module.css';

/** Výběr příloh (DS Reports): řádek souboru s ×, čárkované „Přidat soubor“. */
export function FilePicker({ files, onChange, onError, max = MAX_FILES }: { files: File[]; onChange: (f: File[]) => void; onError: (e: string | null) => void; max?: number }) {
  const id = useId();
  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const bad = checkFile(f);
      if (bad) { onError(bad); continue; }
      if (next.length >= max) { onError(`Najednou jde přiložit nejvýš ${max} souborů.`); break; }
      next.push(f);
    }
    onChange(next);
  };
  return (
    <div className={styles.files}>
      {files.map((f, n) => (
        <div key={`${f.name}-${n}`} className={styles.file}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5" /></svg>
          <span>{f.name}</span>
          <button type="button" className={styles.fileX} aria-label={`Odebrat ${f.name}`} onClick={() => onChange(files.filter((_, i) => i !== n))}>×</button>
        </div>
      ))}
      {files.length < max ? (
        <label htmlFor={id} className={styles.fileAdd}>
          Přidat soubor
          <input id={id} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </label>
      ) : null}
    </div>
  );
}
