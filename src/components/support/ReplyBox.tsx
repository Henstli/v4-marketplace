'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/trezor';
import { addNote, replyUpload, sendCaseEmail } from '@/app/sprava/podpora/actions';
import { createClient } from '@/lib/supabase/browser';
import type { Template } from '@/lib/support';
import styles from '@/app/sprava/podpora/podpora.module.css';

export interface ReplyTarget { id: 'user' | 'other' | 'both' | 'contact'; label: string; via: string }

/** Odpověď nebo interní poznámka pod časovou osou případu (DS Support › Případ › Odpověď). */
export function ReplyBox({ caseId, number, targets, templates }: { caseId: string; number: number; targets: ReplyTarget[]; templates: Template[] }) {
  const [tab, setTab] = useState<'reply' | 'note'>(targets.length ? 'reply' : 'note');
  const [to, setTo] = useState(targets[0]?.id ?? '');
  const [text, setText] = useState('');
  const [all, setAll] = useState(false);
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [upload, setUpload] = useState<'idle' | 'busy' | string>('idle');
  const picker = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const use = (t: Template) => {
    setText(t.body);
    setAll(false);
    area.current?.focus();
  };

  async function attach(f: File) {
    setUpload('busy');
    const r = await replyUpload(caseId, f.name, f.type, f.size);
    if (!r.path || !r.token) { setUpload(r.error ?? 'Přílohu se nepodařilo nahrát.'); return; }
    const { error } = await createClient().storage.from('support-files').uploadToSignedUrl(r.path, r.token, f, { contentType: f.type });
    if (error) { setUpload('Přílohu se nepodařilo nahrát.'); return; }
    setFile({ path: r.path, name: f.name });
    setUpload('idle');
  }

  const target = targets.find((t) => t.id === to);

  return (
    <div className={`${styles.box} ${styles.reply}`}>
      <div className={styles.replyHead}>
        <div className={styles.row} role="group" aria-label="Typ odpovědi">
          <button type="button" className="tz-chip" aria-pressed={tab === 'reply'} disabled={!targets.length} onClick={() => setTab('reply')}>Odpověď</button>
          <button type="button" className="tz-chip" aria-pressed={tab === 'note'} onClick={() => setTab('note')}>Interní poznámka</button>
        </div>
        <span className={styles.small}>{tab === 'reply' ? `${target?.label ?? ''} · ${target?.via ?? ''}` : 'uživatel ji nevidí'}</span>
      </div>

      {tab === 'reply' ? (
        <form action={sendCaseEmail} className={styles.main}>
          <input type="hidden" name="case_id" value={caseId} />
          {targets.length > 1 ? (
            <label className={styles.field}>Komu
              <select className={styles.input} name="to" value={to} onChange={(e) => setTo(e.target.value as ReplyTarget['id'])}>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          ) : <input type="hidden" name="to" value={to} />}
          {templates.length ? (
            <div className={styles.row}>
              <span className={styles.small}>Hotové odpovědi:</span>
              {templates.slice(0, 3).map((t) => <button key={t.id} type="button" className="tz-chip" onClick={() => use(t)}>{t.label}</button>)}
              {templates.length > 3 ? <button type="button" className="tz-chip" aria-expanded={all} onClick={() => setAll(!all)}>Všechny…</button> : null}
            </div>
          ) : null}
          {all ? (
            <ul className={styles.tplList}>
              {templates.map((t) => (
                <li key={t.id}><button type="button" onClick={() => use(t)}><strong>{t.label}</strong><span>{t.body.replace(/\s+/g, ' ').slice(0, 110)}…</span></button></li>
              ))}
            </ul>
          ) : null}
          <textarea ref={area} className={styles.input} name="body" rows={8} required minLength={10} maxLength={8000} value={text}
            onChange={(e) => setText(e.target.value)} aria-label="Text odpovědi" placeholder="Napište odpověď…" />
          <p className={styles.small}>Rozloučení se doplní samo. Do chatu jde odpověď hned, e-mailem po 30 minutách, když ji uživatel nepřečte. Odpověď s přílohou jde e-mailem hned.</p>
          {file ? (
            <>
              <input type="hidden" name="file_path" value={file.path} />
              <input type="hidden" name="file_name" value={file.name} />
            </>
          ) : null}
          <div className={styles.row}>
            <input ref={picker} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ''; }} />
            {file ? (
              <span className={styles.fileChip}>
                <ClipIcon /> {file.name}
                <button type="button" aria-label="Odebrat přílohu" onClick={() => setFile(null)}>×</button>
              </span>
            ) : (
              <Button variant="secondary" onClick={() => picker.current?.click()} disabled={upload === 'busy'}>
                <ClipIcon /> {upload === 'busy' ? 'Nahrávám…' : 'Přiložit'}
              </Button>
            )}
            {upload !== 'idle' && upload !== 'busy' ? <span className={styles.late}>{upload}</span> : null}
            <span style={{ flex: 1 }} />
            <Button type="submit" name="after" value="resolve" variant="secondary" disabled={upload === 'busy'}>Odeslat a vyřešit</Button>
            <Button type="submit" name="after" value="wait" disabled={upload === 'busy'}>Odeslat a čekat na odpověď</Button>
          </div>
        </form>
      ) : (
        <form action={addNote} className={styles.main}>
          <input type="hidden" name="case_id" value={caseId} />
          <input type="hidden" name="number" value={number} />
          <textarea className={styles.input} name="body" rows={5} required maxLength={8000} aria-label="Poznámka" placeholder="Poznámka pro tým (uživatel ji nevidí)…" />
          <div className={`${styles.row} ${styles.rowEnd}`}><Button type="submit" variant="secondary">Uložit poznámku</Button></div>
        </form>
      )}
    </div>
  );
}

function ClipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
    </svg>
  );
}
