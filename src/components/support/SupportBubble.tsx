'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/trezor';
import { contactSupport } from '@/app/podpora/actions';
import { createClient } from '@/lib/supabase/browser';
import { caseCode, STATUS, SUPPORT_TOPICS, type CaseStatus } from '@/lib/support';
import styles from './bubble.module.css';

interface MyCase { number: number; subject: string; status: CaseStatus; unread: number; last_at: string }
interface Msg { id: number; mine: boolean; body: string; at: string; author: string | null }
interface Thread { number: number; subject: string; status: CaseStatus; typing: boolean; messages: Msg[] }
type View = { kind: 'list' } | { kind: 'thread'; number: number } | { kind: 'new' };

const USER_STATUS: Record<CaseStatus, string> = { open: 'Řešíme', waiting: 'Čekáme na vás', resolved: STATUS.resolved };
const time = (iso: string) => new Date(iso).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Chat s podporou vpravo dole pro přihlášené (DS Support › Chat s podporou). Dotazy, odpovědi podpory
 * a psaní dál; nový dotaz založí případ stejně jako formulář /podpora.
 */
export function SupportBubble() {
  const path = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [cases, setCases] = useState<MyCase[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLOListElement>(null);

  const loadCases = useCallback(async () => {
    const { data } = await createClient().rpc('my_support_cases');
    if (data) setCases(data as MyCase[]);
  }, []);

  const loadThread = useCallback(async (n: number) => {
    const { data, error: e } = await createClient().rpc('my_case_thread', { p_number: n });
    if (e) { setError(e.message); return; }
    setThread(data as Thread);
  }, []);

  // Přihlášení se ověří při každém přechodu (stejně jako hlavička), počet nových odpovědí každou minutu.
  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const { data: aal } = session ? await supabase.auth.mfa.getAuthenticatorAssuranceLevel() : { data: null };
      const ok = !!session && !(aal?.currentLevel === 'aal1' && aal.nextLevel === 'aal2');
      if (!alive) return;
      setSignedIn(ok);
      if (ok) void loadCases();
    })();
    return () => { alive = false; };
  }, [path, loadCases]);

  useEffect(() => {
    if (!signedIn) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (open && view.kind === 'thread') void loadThread(view.number);
      else void loadCases();
    };
    const t = setInterval(tick, open && view.kind === 'thread' ? 10000 : 60000);
    return () => clearInterval(t);
  }, [signedIn, open, view, loadCases, loadThread]);

  useEffect(() => {
    if (open && view.kind === 'thread') void loadThread(view.number);
    if (open && view.kind === 'list') void loadCases();
  }, [open, view, loadThread, loadCases]);

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [thread?.messages.length]);

  // Ve zprávách by bublina zakryla pole pro psaní.
  if (!signedIn || path.startsWith('/zpravy/')) return null;
  const unread = cases.reduce((n, c) => n + c.unread, 0);

  async function send(form: HTMLFormElement) {
    if (view.kind !== 'thread') return;
    const body = String(new FormData(form).get('body') ?? '').trim();
    if (!body) return;
    setBusy(true);
    const { error: e } = await createClient().rpc('my_case_post', { p_number: view.number, p_body: body });
    setBusy(false);
    if (e) { setError(e.message); return; }
    form.reset();
    setError('');
    void loadThread(view.number);
  }

  async function create(form: HTMLFormElement) {
    setBusy(true);
    const r = await contactSupport(new FormData(form));
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setError('');
    if (r.ok) setView({ kind: 'thread', number: r.ok });
  }

  return (
    <div className={styles.wrap}>
      {open ? (
        <section className={styles.panel} aria-label="Chat s podporou">
          {view.kind === 'list' ? (
            <>
              <header className={styles.head}>
                <span><strong>Podpora V4cards</strong><span className={styles.small}>obvykle odpovídáme do 24 h</span></span>
                <button type="button" className={styles.close} aria-label="Zavřít" onClick={() => setOpen(false)}>×</button>
              </header>
              <div className={styles.scroll}>
                <Button onClick={() => { setError(''); setView({ kind: 'new' }); }} style={{ width: '100%' }}>Nový dotaz</Button>
                <span className={styles.label}>MOJE DOTAZY</span>
                <ul className={styles.cases}>
                  {cases.map((c) => (
                    <li key={c.number}>
                      <button type="button" onClick={() => { setError(''); setThread(null); setView({ kind: 'thread', number: c.number }); }}>
                        <span className={styles.caseText}>
                          <strong>{c.subject}</strong>
                          <span className={styles.small}>{caseCode(c.number)} · {USER_STATUS[c.status]}</span>
                        </span>
                        {c.unread ? <span className={styles.pill}>{c.unread === 1 ? '1 nová' : `${c.unread} nové`}</span> : null}
                      </button>
                    </li>
                  ))}
                  {!cases.length ? <li className={styles.small}>Zatím jste nám nepsali.</li> : null}
                </ul>
                <div className={styles.links}>
                  <Link href="/podpora" onClick={() => setOpen(false)}>Napsat s přílohou</Link>
                  <Link href="/obchodni-podminky" onClick={() => setOpen(false)}>Obchodní podmínky</Link>
                  <Link href="/ucet/nastaveni#podpora" onClick={() => setOpen(false)}>Kudy posílat odpovědi</Link>
                </div>
              </div>
            </>
          ) : view.kind === 'new' ? (
            <>
              <header className={styles.head}>
                <button type="button" className={styles.back} aria-label="Zpět" onClick={() => setView({ kind: 'list' })}>‹</button>
                <span><strong>Nový dotaz</strong></span>
                <button type="button" className={styles.close} aria-label="Zavřít" onClick={() => setOpen(false)}>×</button>
              </header>
              <form className={styles.newForm} onSubmit={(e) => { e.preventDefault(); void create(e.currentTarget); }}>
                <label className={styles.field}>Téma
                  <select name="topic" className={styles.input} defaultValue="account">
                    {SUPPORT_TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </label>
                <label className={styles.field}>Zpráva
                  <textarea name="body" className={styles.input} rows={7} required minLength={10} maxLength={4000} placeholder="Napište, s čím potřebujete pomoct…" />
                </label>
                {error ? <p className={styles.error} role="alert">{error}</p> : null}
                <Button type="submit" disabled={busy}>{busy ? 'Odesílám…' : 'Odeslat'}</Button>
              </form>
            </>
          ) : (
            <>
              <header className={styles.head}>
                <button type="button" className={styles.back} aria-label="Zpět" onClick={() => { setView({ kind: 'list' }); setThread(null); }}>‹</button>
                <span>
                  <strong>{caseCode(view.number)}</strong>
                  <span className={styles.small}>{thread ? `${thread.subject} · ${USER_STATUS[thread.status]}` : 'Načítám…'}</span>
                </span>
                <button type="button" className={styles.close} aria-label="Zavřít" onClick={() => setOpen(false)}>×</button>
              </header>
              <ol ref={list} className={styles.msgs}>
                {(thread?.messages ?? []).map((m) => (
                  <li key={m.id} className={m.mine ? styles.mine : styles.theirs}>
                    {!m.mine ? <span className={styles.small}>{m.author} z podpory</span> : null}
                    <span className={styles.bubbleText}>{m.body}</span>
                    <span className={styles.time}>{time(m.at)}</span>
                  </li>
                ))}
                {thread?.typing ? <li className={styles.typing}>Podpora píše…</li> : null}
              </ol>
              <form className={styles.compose} onSubmit={(e) => { e.preventDefault(); void send(e.currentTarget); }}>
                {error ? <p className={styles.error} role="alert">{error}</p> : null}
                <div className={styles.composeRow}>
                  <textarea name="body" className={styles.input} rows={2} maxLength={4000} required placeholder="Napište zprávu…" aria-label="Zpráva"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
                  <Button type="submit" disabled={busy}>Odeslat</Button>
                </div>
                <span className={styles.small}>
                  Odpovědi dostáváte sem. Když tu nebudete, pošleme i e-mail. <Link href="/ucet/nastaveni#podpora" onClick={() => setOpen(false)}>Změnit</Link>
                </span>
              </form>
            </>
          )}
        </section>
      ) : null}
      <button type="button" className={styles.fab} aria-label={open ? 'Zavřít chat s podporou' : 'Chat s podporou'} aria-expanded={open}
        onClick={() => { setOpen(!open); setView(unread && cases.filter((c) => c.unread).length === 1 ? { kind: 'thread', number: cases.find((c) => c.unread)!.number } : { kind: 'list' }); }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" />
        </svg>
        {unread > 0 && !open ? <span className={styles.count}>{unread}</span> : null}
      </button>
    </div>
  );
}
