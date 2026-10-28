'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/trezor';
import { reportContent, type ReportContentState } from '@/app/nahlasit/actions';
import { CONTENT_REASON, contentCode, KIND_REASONS, KIND_TITLE, type ContentKind } from '@/lib/content-reports';
import styles from './reports.module.css';

const FLAG = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </svg>
);

export interface ContentPreview { title: string; lines?: string[] }

/**
 * Pole formuláře nahlášení: důvod, popis, prohlášení o dobré víře. U „other“ (patička) navíc odkaz,
 * a když člověk není přihlášený, jméno a e-mail.
 */
export function ContentReportForm({ kind, target, preview, contact, defaultUrl, onCancel, onDone }: {
  kind: ContentKind;
  target?: string;
  preview?: ContentPreview;
  /** Nepřihlášený na stránce Nahlásit: jméno a e-mail */
  contact?: boolean;
  defaultUrl?: string;
  onCancel?: () => void;
  onDone?: (number: number) => void;
}) {
  const [state, action, pending] = useActionState<ReportContentState, FormData>(reportContent, {});
  const pathname = usePathname();
  useEffect(() => { if (state.ok) onDone?.(state.ok); }, [state.ok, onDone]);

  if (state.ok !== undefined) {
    return (
      <div className={styles.form} role="status">
        <h3 className={styles.formTitle}>Děkujeme</h3>
        <p className="t-small">
          Nahlášení {state.ok ? contentCode(state.ok) : ''} jsme přijali. Prověří ho člověk z týmu V4cards a o výsledku vám dáme vědět e-mailem.
        </p>
        {onCancel ? <Button onClick={onCancel}>Zavřít</Button> : null}
      </div>
    );
  }
  if (state.login) {
    return (
      <div className={styles.form}>
        <h3 className={styles.formTitle}>Pro nahlášení se přihlaste</h3>
        <p className="t-small">Nahlásit nabídku, prodejce, zprávu nebo hodnocení může přihlášený uživatel. Bez přihlášení použijte formulář <Link href="/nahlasit">Nahlásit nezákonný obsah</Link>.</p>
        <div className={styles.two}>
          {onCancel ? <Button variant="ghost" onClick={onCancel}>Zpět</Button> : <span />}
          <Link href={`/prihlaseni?dalsi=${encodeURIComponent(pathname)}`} className="tz-btn tz-btn-primary tz-btn-md">Přihlásit se</Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className={styles.form}>
      <h3 className={styles.formTitle}>{KIND_TITLE[kind]}</h3>
      <input type="hidden" name="kind" value={kind} />
      {target ? <input type="hidden" name="target" value={target} /> : null}
      <label className={styles.trap} aria-hidden="true">Web<input name="web" tabIndex={-1} autoComplete="off" /></label>
      {preview ? (
        <div className={styles.preview}>
          <strong>{preview.title}</strong>
          {preview.lines?.map((l) => <span key={l} className="t-small muted">{l}</span>)}
        </div>
      ) : null}
      {kind === 'other' ? (
        <label className={styles.field}>
          <span className="t-small muted">Odkaz na stránku</span>
          <input className={styles.input} name="url" type="url" required maxLength={500} defaultValue={defaultUrl} placeholder="https://www.v4cards.com/…" />
        </label>
      ) : null}
      <fieldset className={styles.reasons}>
        <legend className="t-label muted">CO JE ŠPATNĚ</legend>
        {KIND_REASONS[kind].map((r) => (
          <label key={r} className={styles.reason}>
            <input type="radio" name="reason" value={r} required />
            {CONTENT_REASON[r]}
          </label>
        ))}
      </fieldset>
      <label className={styles.field}>
        <span className="t-small muted">Popište, co je špatně</span>
        <textarea className={styles.input} name="body" required minLength={10} maxLength={2000} rows={3} />
      </label>
      {contact ? (
        <div className={styles.two}>
          <label className={styles.field}>
            <span className="t-small muted">Jméno</span>
            <input className={styles.input} name="name" required maxLength={120} autoComplete="name" />
          </label>
          <label className={styles.field}>
            <span className="t-small muted">E-mail</span>
            <input className={styles.input} name="email" type="email" required maxLength={200} autoComplete="email" />
          </label>
        </div>
      ) : null}
      <label className={styles.check}>
        <input type="checkbox" name="good_faith" required />
        <span>Údaje uvádím v dobré víře, pravdivě a úplně.</span>
      </label>
      <p className="t-small muted">Nahlášení prověří člověk z týmu V4cards. O výsledku vám dáme vědět e-mailem.</p>
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <div className={styles.two}>
        {onCancel ? <Button variant="ghost" onClick={onCancel} disabled={pending}>Zpět</Button> : <span />}
        <Button type="submit" disabled={pending}>{pending ? 'Odesílám…' : 'Odeslat'}</Button>
      </div>
    </form>
  );
}

/**
 * Tlačítko „Nahlásit“ s oknem (DS Reports › Nahlásit obsah):
 * menu = ikona ⋯ s položkou (řádek nabídky), link = malý odkaz s vlajkou (profil, hodnocení),
 * chat = ikona vlajky vedle zprávy.
 */
export function ReportContent({ kind, target, preview, variant, className, label }: {
  kind: Exclude<ContentKind, 'other'>;
  target: string;
  preview?: ContentPreview;
  variant: 'menu' | 'link' | 'chat';
  className?: string;
  label?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  // Klíč formuláře: po zavření a novém otevření začíná znovu.
  const [round, setRound] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menu]);

  const show = () => { setMenu(false); setOpen(true); setRound((r) => r + 1); dialog.current?.showModal(); };
  const close = () => dialog.current?.close();
  const text = label ?? KIND_TITLE[kind];

  return (
    <>
      {variant === 'menu' ? (
        <div className={styles.moreWrap} ref={wrap}>
          <button type="button" className={`${styles.more} ${className ?? ''}`} aria-label="Další možnosti" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          {menu ? (
            <div className={styles.menu} role="menu">
              <button type="button" role="menuitem" className={styles.menuItem} onClick={show}>{FLAG}{text}</button>
            </div>
          ) : null}
        </div>
      ) : (
        <button type="button" className={`${styles.flag} ${className ?? ''}`} onClick={show} aria-label={variant === 'chat' ? text : undefined} title={variant === 'chat' ? text : undefined}>
          {FLAG}{variant === 'chat' ? null : text}
        </button>
      )}
      <dialog ref={dialog} className={styles.dialog} onClose={() => setOpen(false)} aria-label={text}>
        {open ? <ContentReportForm key={round} kind={kind} target={target} preview={preview} onCancel={close} /> : null}
      </dialog>
    </>
  );
}
