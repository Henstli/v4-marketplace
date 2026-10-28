'use client';

import { useState } from 'react';
import { attachSupportFile, contactSupport } from '@/app/podpora/actions';
import { Button, FileDrop } from '@/components/trezor';
import { createClient } from '@/lib/supabase/browser';
import { caseCode, SUPPORT_TOPICS, type SupportTopic } from '@/lib/support';
import styles from './contact.module.css';

export interface OrderOption { number: number; label: string }

const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Formulář Napsat podpoře (DS Support › Napsat podpoře). Příloha jde z prohlížeče rovnou do úložiště. */
export function ContactForm({ email, orders, defaultTopic, defaultOrder }: {
  /** E-mail přihlášeného; null = nepřihlášený vyplní jméno a e-mail */
  email: string | null;
  orders: OrderOption[];
  defaultTopic?: SupportTopic;
  defaultOrder?: number;
}) {
  const [topic, setTopic] = useState<SupportTopic | undefined>(defaultTopic);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ number: number; fileError?: string } | null>(null);

  const pick = (f: File) => {
    if (!FILE_TYPES.includes(f.type)) return setError('Přiložte fotku (JPG, PNG, WebP) nebo PDF.');
    if (f.size > 10 * 1024 * 1024) return setError('Příloha může mít nejvýš 10 MB.');
    setError(null);
    setFile(f);
  };

  const submit = async (form: FormData) => {
    if (pending) return;
    setPending(true);
    setError(null);
    if (file) {
      form.set('file_name', file.name);
      form.set('file_type', file.type);
      form.set('file_size', String(file.size));
    }
    const res = await contactSupport(form).catch(() => ({ error: 'Zprávu se nepodařilo odeslat. Zkuste to znovu.' } as const));
    if ('error' in res && res.error) {
      setError(res.error);
      setPending(false);
      return;
    }
    let fileError: string | undefined;
    if (file && 'upload' in res && res.upload) {
      const { error: up } = await createClient().storage.from('support-files').uploadToSignedUrl(res.upload.path, res.upload.token, file, { contentType: file.type });
      const saved = up ? { error: 'up' } : await attachSupportFile(res.upload.caseId, res.upload.path, file.name);
      if (saved.error) fileError = 'Přílohu se nepodařilo nahrát. Pošlete ji prosím odpovědí na potvrzovací e-mail.';
    }
    setDone({ number: 'ok' in res ? res.ok ?? 0 : 0, fileError });
    setPending(false);
  };

  if (done) {
    return (
      <div className={styles.form} role="status">
        <h2 className={styles.title}>Děkujeme, máme to</h2>
        <p>
          {done.number ? <>Váš dotaz má číslo <span className="code">{caseCode(done.number)}</span>. </> : null}
          Odpověď vám pošleme e-mailem, nejpozději do 2 dnů. Doplnit něco můžete odpovědí na potvrzovací e-mail.
        </p>
        {done.fileError ? <p className={styles.warn}>{done.fileError}</p> : null}
      </div>
    );
  }

  return (
    <form action={submit} className={styles.form}>
      <label className={styles.trap} aria-hidden="true">Web<input name="web" tabIndex={-1} autoComplete="off" /></label>
      <fieldset className={styles.topics}>
        <legend className="t-label muted">TÉMA</legend>
        <div className={styles.chips}>
          {SUPPORT_TOPICS.map((t) => (
            <label key={t.id} className={styles.chip}>
              <input type="radio" name="topic" value={t.id} required checked={topic === t.id} onChange={() => setTopic(t.id)} />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      {topic === 'order' && orders.length ? (
        <label className={styles.field}>
          <span className="t-small muted">Objednávka</span>
          <select className={styles.input} name="order" defaultValue={defaultOrder && orders.some((o) => o.number === defaultOrder) ? defaultOrder : ''}>
            <option value="">Jiná / nevím</option>
            {orders.map((o) => <option key={o.number} value={o.number}>{o.label}</option>)}
          </select>
        </label>
      ) : null}
      {topic === 'appeal' ? (
        <p className="t-small muted">Napište, proč s omezením nesouhlasíte. Posoudí to jiný člověk z týmu, než který rozhodl, do 7 dnů.</p>
      ) : null}
      <label className={styles.field}>
        <span className="t-small muted">Zpráva</span>
        <textarea className={styles.input} name="body" required minLength={10} maxLength={4000} rows={6} />
      </label>
      <FileDrop
        accept="image/jpeg,image/png,image/webp,application/pdf"
        title="Přiložit fotku nebo PDF (nepovinné)"
        hint="Jeden soubor do 10 MB"
        fileName={file?.name}
        onFile={pick}
        disabled={pending}
        label="Vybrat přílohu"
      />
      {email ? null : (
        <div className={styles.two}>
          <label className={styles.field}>
            <span className="t-small muted">Jméno</span>
            <input className={styles.input} name="name" required minLength={2} maxLength={120} autoComplete="name" />
          </label>
          <label className={styles.field}>
            <span className="t-small muted">E-mail</span>
            <input className={styles.input} name="email" type="email" required maxLength={200} autoComplete="email" />
          </label>
        </div>
      )}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.foot}>
        <span className="t-small muted">{email ? `Odpověď přijde na e-mail ${email}.` : 'Odpověď přijde na zadaný e-mail.'}</span>
        <Button type="submit" disabled={pending}>{pending ? 'Odesílám…' : 'Odeslat'}</Button>
      </div>
    </form>
  );
}
