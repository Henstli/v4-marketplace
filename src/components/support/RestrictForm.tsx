'use client';

import { useState } from 'react';
import { ButtonLink } from '@/components/trezor';
import { restrictUser } from '@/app/sprava/podpora/actions';
import { formatDate } from '@/lib/format';
import { ACTION_LABEL, DURATIONS, MEASURES, REASON_GROUPS, REASONS, restrictionMail, type ModAction } from '@/lib/support';
import styles from '@/app/sprava/podpora/podpora.module.css';

type Measure = (typeof MEASURES)[number]['id'];

/** Doporučený další krok podle dosavadních opatření: upozornění, skrytí, pozastavení na 7 dní, zrušení. */
function recommend(count: number): { action: Measure; days: number } {
  if (count === 0) return { action: 'warning', days: 0 };
  if (count === 1) return { action: 'hide_listings', days: 7 };
  if (count === 2) return { action: 'suspend', days: 7 };
  return { action: 'ban', days: 0 };
}

/** Formulář omezení účtu s náhledem e-mailu s odůvodněním (DS Support › Omezit účet). */
export function RestrictForm({ userId, name, isShop, cases, past }: {
  userId: string;
  name: string;
  isShop: boolean;
  cases: Array<{ id: string; number: number; subject: string }>;
  past: Array<{ action: string; created_at: string }>;
}) {
  const rec = recommend(past.length);
  const [action, setAction] = useState<Measure>(rec.action);
  const [days, setDays] = useState(rec.days || 7);
  const [reason, setReason] = useState('');
  const [facts, setFacts] = useState('');
  const [caseId, setCaseId] = useState(cases[0]?.id ?? '');
  const caseNumber = cases.find((c) => c.id === caseId)?.number ?? null;
  const timed = action === 'hide_listings' || action === 'suspend';
  const mail = restrictionMail({ action, name, reasonId: reason || 'other', facts, days: timed ? days : 0, caseNumber });
  const span = days ? `na ${DURATIONS.find((d) => d.days === days)?.label ?? `${days} dní`}` : 'do odvolání';
  const button = {
    warning: 'Upozornit a poslat e-mail',
    hide_listings: `Skrýt nabídky ${span}`,
    suspend: `Pozastavit ${span}`,
    ban: 'Zrušit účet a poslat odůvodnění',
  }[action];
  const recLabel = MEASURES.find((m) => m.id === rec.action)!.label + (rec.days ? ` na ${rec.days} dní` : '');
  const history = past.length
    ? past.slice(0, 3).map((p) => `${ACTION_LABEL[p.action as ModAction]} ${formatDate(p.created_at)}`).join(', ')
    : 'zatím žádné opatření';

  return (
    <>
      <p className={styles.infoBar}>Historie: {history}. Doporučený další krok: <strong>{recLabel}</strong>.</p>
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

          <fieldset className={styles.reasons}>
            <legend className={styles.boxTitle}>DŮVOD</legend>
            <div className={styles.reasonCols}>
              {REASON_GROUPS.map((g) => (
                <div key={g.id} className={styles.reasonCol}>
                  <span className={styles.label}>{g.label}</span>
                  {REASONS.filter((r) => r.group === g.id).map((r) => (
                    <label key={r.id} className={styles.reason}>
                      <input type="radio" name="reason" value={r.id} required checked={reason === r.id} onChange={() => setReason(r.id)} />
                      {r.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <label className={styles.reason}>
              <input type="radio" name="reason" value="other" checked={reason === 'other'} onChange={() => setReason('other')} />
              Jiné porušení obchodních podmínek
            </label>
          </fieldset>

          {timed ? (
            <label className={styles.field}>Na jak dlouho
              <select className={styles.input} name="days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {DURATIONS.map((d) => <option key={d.days} value={d.days}>{d.label}</option>)}
              </select>
            </label>
          ) : null}
          <label className={styles.field}>Z čeho vycházíte (uvidí to uživatel)
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
            <span className={styles.small} style={{ flex: '1 1 200px' }}>Uloží se do Záznamu akcí s vaším jménem. Zrušit opatření půjde jedním klikem.</span>
            <ButtonLink href={`/sprava/podpora/uzivatele/${userId}`} variant="ghost">Zpět</ButtonLink>
            <button type="submit" className={styles.warnBtn} disabled={facts.trim().length < 20 || !reason}>{button}</button>
          </div>
        </form>

        <section aria-label="Náhled e-mailu" className={styles.preview}>
          <span className={styles.previewLabel}>NÁHLED E-MAILU UŽIVATELI</span>
          <span className={styles.previewMeta}>Od: podpora@v4cards.com · Předmět: {mail.subject}</span>
          {mail.paragraphs.map((p, i) => <p key={i}>{p.title ? <strong>{p.title} </strong> : null}{p.text}</p>)}
        </section>
      </div>
    </>
  );
}
