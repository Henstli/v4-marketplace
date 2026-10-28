'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import { createReport } from '@/app/ucet/hlaseni-actions';
import { BUYER_REASONS, REASON, SELLER_REASONS, type ReportReason } from '@/lib/reports';
import { FilePicker } from './FilePicker';
import { uploadReportFiles } from './upload';
import styles from './reports.module.css';

interface ReportTarget { orderId: string; number: number; role: 'buyer' | 'seller'; uid: string | null; delivered: boolean }

/** Formulář hlášení: důvod, popis a přílohy. Stejný v detailu objednávky i v okně v chatu. */
function ReportFields({ orderId, number, role, uid, delivered, onCancel, onDone }: ReportTarget & { onCancel: () => void; onDone: (r: { id: string; number: number | null; warning: string | null }) => void }) {
  const reasons = (role === 'buyer' ? BUYER_REASONS : SELLER_REASONS).filter((r) => r !== 'not_as_described' || delivered);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => start(async () => {
    setError(null);
    if (!reason) { setError('Vyberte, co se stalo.'); return; }
    if (text.trim().length < 10) { setError('Popište, co se stalo (aspoň pár slov).'); return; }
    const res = await createReport(orderId, reason, text.trim());
    if (res.error || !res.id) { setError(res.error ?? 'Hlášení se nepodařilo odeslat.'); return; }
    const bad = files.length ? await uploadReportFiles(res.id, uid, files) : null;
    onDone({ id: res.id, number: res.number ?? null, warning: bad ? `Hlášení je odeslané, ale ${bad.charAt(0).toLowerCase()}${bad.slice(1)} Přílohu přidáte v detailu hlášení.` : null });
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
        <Button variant="ghost" onClick={() => { setError(null); onCancel(); }} disabled={pending}>Zpět</Button>
        <Button onClick={submit} disabled={pending}>{pending ? 'Odesílám…' : 'Odeslat'}</Button>
      </div>
    </div>
  );
}

/** „Nahlásit problém“ v detailu objednávky (DS Reports, obrazovka 3): odkaz, který se rozbalí ve formulář. */
export function ReportForm(props: ReportTarget) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Starší odkazy s #nahlasit formulář rovnou otevřou.
  useEffect(() => { if (window.location.hash === '#nahlasit') setOpen(true); }, []);

  if (!open) return <button type="button" className={styles.link} onClick={() => setOpen(true)} id="nahlasit">Nahlásit problém</button>;
  return (
    <ReportFields
      {...props}
      onCancel={() => setOpen(false)}
      onDone={(r) => {
        router.push(r.number ? `/ucet/hlaseni/${r.number}` : '/ucet/hlaseni');
      }}
    />
  );
}

/** „Nahlásit problém“ v chatu (DS Messages › Nahlásit problém): stejný formulář v okně, chat zůstane otevřený. */
export function ReportDialog({ className, ...props }: ReportTarget & { className?: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ number: number | null; warning: string | null } | null>(null);
  const show = () => { setDone(null); setOpen(true); dialog.current?.showModal(); };
  const close = () => dialog.current?.close();
  return (
    <>
      <button type="button" className={className} onClick={show}>Nahlásit problém</button>
      <dialog ref={dialog} className={styles.dialog} onClose={() => { setOpen(false); if (done) router.refresh(); }} aria-label={`Nahlásit problém s objednávkou č. ${props.number}`}>
        {done ? (
          <div className={styles.form}>
            <h3 className={styles.formTitle}>Hlášení je odeslané</h3>
            <p className="t-small">Druhé straně jsme dali vědět v chatu. Stav hlášení najdete v Můj profil › Hlášení.</p>
            {done.warning ? <p className={styles.error} role="alert">{done.warning}</p> : null}
            <div className={styles.two}>
              <Button variant="ghost" onClick={() => router.push(done.number ? `/ucet/hlaseni/${done.number}` : '/ucet/hlaseni')}>Otevřít hlášení</Button>
              <Button onClick={close}>Zpět do chatu</Button>
            </div>
          </div>
        ) : open ? (
          <ReportFields {...props} onCancel={close} onDone={(r) => setDone({ number: r.number, warning: r.warning })} />
        ) : null}
      </dialog>
    </>
  );
}
