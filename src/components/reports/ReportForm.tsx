'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import { createReport } from '@/app/ucet/hlaseni-actions';
import { BUYER_REASONS, REASON, SELLER_REASONS, type ReportReason } from '@/lib/reports';
import { FilePicker } from './FilePicker';
import { uploadReportFiles } from './upload';
import styles from './reports.module.css';

/** „Nahlásit problém“ u objednávky (DS Reports, obrazovka 3): odkaz, který se rozbalí ve formulář. */
export function ReportForm({ orderId, number, role, uid, delivered }: { orderId: string; number: number; role: 'buyer' | 'seller'; uid: string; delivered: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const reasons = (role === 'buyer' ? BUYER_REASONS : SELLER_REASONS).filter((r) => r !== 'not_as_described' || delivered);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Odkaz „Nahlásit problém“ z chatu vede sem s #nahlasit a formulář se rovnou otevře.
  useEffect(() => { if (window.location.hash === '#nahlasit') setOpen(true); }, []);

  if (!open) return <button type="button" className={styles.link} onClick={() => setOpen(true)} id="nahlasit">Nahlásit problém</button>;

  const submit = () => start(async () => {
    setError(null);
    if (!reason) { setError('Vyberte, co se stalo.'); return; }
    if (text.trim().length < 10) { setError('Popište, co se stalo (aspoň pár slov).'); return; }
    const res = await createReport(orderId, reason, text.trim());
    if (res.error || !res.id) { setError(res.error ?? 'Hlášení se nepodařilo odeslat.'); return; }
    if (files.length) {
      const bad = await uploadReportFiles(res.id, uid, files);
      if (bad) setError(`Hlášení je odeslané, ale ${bad.charAt(0).toLowerCase()}${bad.slice(1)} Přílohu přidáte v detailu hlášení.`);
    }
    router.push(res.number ? `/ucet/hlaseni/${res.number}` : '/ucet/hlaseni');
  });

  return (
    <div className={styles.form} id="nahlasit">
      <h3 className={styles.formTitle}>Nahlásit problém s objednávkou č. {number}</h3>
      <fieldset className={styles.reasons}>
        <legend className="t-label muted">CO SE STALO</legend>
        {reasons.map((r) => (
          <label key={r} className={styles.reason}>
            <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
            {REASON[r]}
          </label>
        ))}
      </fieldset>
      <label className={styles.field}>
        <span className="t-small muted">Popište, co se stalo</span>
        <textarea className={styles.input} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} rows={3} />
      </label>
      <div className={styles.field}>
        <span className="t-small muted">{role === 'buyer' ? 'Doklad o platbě a fotky' : 'Doklady (výpis plateb, podací lístek)'} (až 5 souborů, JPG, PNG, PDF)</span>
        <FilePicker files={files} onChange={(f) => { setFiles(f); setError(null); }} onError={setError} />
        <span className="t-small muted">
          {reason === 'not_as_described' ? 'Fotky karty uvidí i prodejce, ostatní jen podpora.' : 'Vidí je jen podpora.'} Ostatní platby na výpisu zakryjte.
        </span>
      </div>
      <p className="t-small muted">V4cards peníze nepřijímá a nevrací. Případ prověříme, podle podmínek můžeme omezit účet a pomůžeme vám s podklady pro policii.</p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.two}>
        <Button variant="ghost" onClick={() => { setOpen(false); setError(null); }} disabled={pending}>Zpět</Button>
        <Button onClick={submit} disabled={pending}>{pending ? 'Odesílám…' : 'Odeslat'}</Button>
      </div>
    </div>
  );
}
