'use client';

import { useState } from 'react';
import styles from '@/app/objednavky/orders.module.css';

/** Zkopíruje text do schránky (doručovací údaje u objednávky). */
export function CopyButton({ text, label = 'Kopírovat' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={styles.copy}
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {})}
    >
      {done ? 'Zkopírováno' : label}
    </button>
  );
}
