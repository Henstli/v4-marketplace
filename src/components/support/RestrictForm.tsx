'use client';

import { useState } from 'react';
import Link from 'next/link';
import { restrictUser } from '@/app/sprava/podpora/actions';
import { DURATIONS, MEASURES, REASONS, restrictionMail } from '@/lib/support';
import styles from '@/app/sprava/podpora/podpora.module.css';

type Measure = (typeof MEASURES)[number]['id'];

/** Formulář omezení účtu s náhledem e-mailu s odůvodněním (DS Support, Omezit účet). */
export function RestrictForm({ userId, name, isShop, cases }: {
  userId: string;
  name: string;
  isShop: boolean;
  cases: Array<{ id: string; number: number; subject: string }>;
}) {
  const [action, setAction] = useState<Measure>('suspend');
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState(REASONS[0].id);
  const [facts, setFacts] = useState('');
  const [caseId, setCaseId] = useState(cases[0]?.id ?? '');
  const caseNumber = cases.find((c) => c.id === caseId)?.number ?? null;
  const timed = action === 'hide_listings' || action === 'suspend';
  const mail = restrictionMail({ action, name, reasonId: reason, facts, days: timed ? days : 0, caseNumber });
  const button = { warning: 'Poslat upozornění', hide_listings: 'Skrýt nabídky a poslat odůvodnění', suspend: 'Pozastavit a poslat odůvodnění', ban: 'Zrušit účet a poslat odůvodnění' }[action];

  return (
    <div className={styles.restrict}>
      <form action={restrictUser} className={styles.box}>
        <input type="hidden" name="user_id" value={userId} />
        <fieldset className={styles.measures}>
          <legend className={styles.boxTitle}>OPATŘENÍ</legend>
          {MEASURES.map((m) => (
            <label key={m.id} className={styles.measure}>
              <input type="radio" name="action" value={m.id} checked={action === m.id} onChange={() => setAction(m.id)} />
              <span><strong>{m.label}</strong><small>{m.hint}</small></span>
            </label>
          ))}
        </fieldset>
        {action === 'ban' && isShop ? (
          <p className={`${styles.flash} ${styles.flashErr}`}>Obchodu se zrušení oznamuje 30 dní předem, pokud nejde o závažné nebo opakované porušení (podvod). Jinak zvolte nejdřív pozastavení.</p>
        ) : null}
        <div className={styles.two}>
          <label className={styles.field}>Na jak dlouho
            <select className={styles.input} name="days" value={timed ? days : 0} disabled={!timed} onChange={(e) => setDays(Number(e.target.value))}>
              {DURATIONS.map((d) => <option key={d.days} value={d.days}>{d.label}</option>)}
            </select>
          </label>
          <label className={styles.field}>Důvod podle podmínek
            <select className={styles.input} name="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => <option key={r.id} value={r.id}>{r.label} ({r.article})</option>)}
            </select>
          </label>
        </div>
        <label className={styles.field}>Skutečnosti, ze kterých vycházíme (uvidí je uživatel)
          <textarea className={styles.input} name="facts" rows={5} required minLength={20} maxLength={4000} value={facts} onChange={(e) => setFacts(e.target.value)}
            placeholder="Např. Kupující u objednávky č. 26 doložil platbu 1 240 Kč z 25. 10. Objednávku jste zrušili a na výzvu z 30. 10. jste do 1. 11. neodpověděli." />
        </label>
        <label className={styles.field}>Případ
          <select className={styles.input} name="case_id" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">Založit nový případ</option>
            {cases.map((c) => <option key={c.id} value={c.id}>P-{String(c.number).padStart(4, '0')} · {c.subject}</option>)}
          </select>
        </label>
        <div className={styles.row}>
          <span className={styles.small} style={{ flex: '1 1 200px' }}>Uloží se do záznamu akcí s vaším jménem. Zrušit opatření půjde jedním klikem.</span>
          <Link href={`/sprava/podpora/uzivatele/${userId}`} className={styles.timerBtn} style={{ height: 44, display: 'inline-flex', alignItems: 'center', borderRadius: 'var(--radius-md)', textDecoration: 'none' }}>Zpět</Link>
          <button type="submit" className={styles.warnBtn} disabled={facts.trim().length < 20}>{button}</button>
        </div>
      </form>

      <section aria-label="Náhled e-mailu" className={styles.preview}>
        <span className={styles.previewLabel}>NÁHLED E-MAILU UŽIVATELI</span>
        <span className={styles.previewMeta}>Od: podpora@v4cards.com · Předmět: {mail.subject}</span>
        {mail.paragraphs.map((p, i) => <p key={i}>{p.title ? <strong>{p.title} </strong> : null}{p.text}</p>)}
      </section>
    </div>
  );
}
