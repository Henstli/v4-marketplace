'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import { FilePicker } from './FilePicker';
import { uploadReportFiles } from './upload';
import styles from './reports.module.css';

/** Další přílohy k otevřenému hlášení. */
export function AddFiles({ report, uid, left }: { report: string; uid: string; left: number }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (left <= 0) return <p className="t-small muted">Další přílohy pošlete na podpora@v4cards.com.</p>;
  return (
    <div className={styles.files}>
      <FilePicker files={files} onChange={(f) => { setFiles(f); setError(null); }} onError={setError} max={Math.min(5, left)} />
      {files.length ? (
        <Button variant="secondary" disabled={pending} onClick={() => start(async () => {
          const bad = await uploadReportFiles(report, uid, files);
          if (bad) setError(bad); else setFiles([]);
          router.refresh();
        })}>{pending ? 'Nahrávám…' : 'Nahrát přílohy'}</Button>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
