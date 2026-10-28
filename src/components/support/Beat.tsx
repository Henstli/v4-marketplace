'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { hm } from '@/lib/support';
import styles from '@/app/sprava/podpora/podpora.module.css';

// Čas se počítá sám (DS Support › Čas se počítá sám): každou minutu signál support_beat.
// Aktivní = pohyb myší, klávesa nebo posun v posledních 5 minutách. Píše = klávesa v posledních 20 s.

interface BeatData { today: number; mine: number; total: number; here: Array<{ id: string; name: string; typing: boolean }> }
interface BeatCtx { data: BeatData | null; active: boolean; caseId: string | null; setCase: (id: string | null) => void }

const Ctx = createContext<BeatCtx>({ data: null, active: false, caseId: null, setCase: () => {} });
const IDLE = 5 * 60000;

export function BeatProvider({ children }: { children: ReactNode }) {
  const [caseId, setCaseId] = useState<string | null>(null);
  const [data, setData] = useState<BeatData | null>(null);
  const [active, setActive] = useState(true);
  const lastMove = useRef(Date.now());
  const lastKey = useRef(0);
  const caseRef = useRef<string | null>(null);

  const beat = useCallback(async () => {
    const now = Date.now();
    // Pod 1024 px se panel neukazuje (jen na počítači), takže se čas nepočítá.
    const isActive = document.visibilityState === 'visible' && window.innerWidth >= 1024 && now - lastMove.current < IDLE;
    setActive(isActive);
    const { data: res } = await createClient().rpc('support_beat', {
      p_case: caseRef.current, p_active: isActive, p_typing: isActive && now - lastKey.current < 20000,
    });
    if (res) setData(res as BeatData);
  }, []);

  useEffect(() => {
    const move = () => { lastMove.current = Date.now(); };
    const key = () => { lastMove.current = Date.now(); lastKey.current = Date.now(); };
    window.addEventListener('mousemove', move, { passive: true });
    window.addEventListener('scroll', move, { passive: true });
    window.addEventListener('keydown', key);
    const t = setInterval(beat, 60000);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('scroll', move);
      window.removeEventListener('keydown', key);
      clearInterval(t);
    };
  }, [beat]);

  // Signál hned při otevření stránky a při přechodu mezi případy.
  useEffect(() => { caseRef.current = caseId; void beat(); }, [caseId, beat]);

  return <Ctx.Provider value={{ data, active, caseId, setCase: setCaseId }}>{children}</Ctx.Provider>;
}

/** Stránka případu: čas a přítomnost se počítají k tomuto případu. */
export function BeatCase({ id }: { id: string }) {
  const { setCase } = useContext(Ctx);
  useEffect(() => {
    setCase(id);
    return () => setCase(null);
  }, [id, setCase]);
  return null;
}

/** Fronta vpravo nahoře: Váš čas dnes. */
export function TodayPill({ initial }: { initial: number }) {
  const { data, active } = useContext(Ctx);
  return (
    <span className={styles.today}>
      <span className={`${styles.dot} ${active ? styles.dotLive : ''}`} aria-hidden="true" />
      <span className={styles.todayLabel}>Váš čas dnes</span>
      <span className={styles.todayTime}>{hm(data?.today ?? initial)}</span>
    </span>
  );
}

/** Případ vpravo nahoře: kdo je v případu teď (jen jména s tečkou). */
export function CasePresence({ me }: { me: string }) {
  const { data } = useContext(Ctx);
  const others = (data?.here ?? []).filter((p) => p.id !== me);
  if (!others.length) return null;
  return (
    <span className={styles.presence}>
      <span className={styles.qmuted}>V případu:</span>
      {others.map((p) => (
        <span key={p.id} className={styles.presenceName}>
          <span className={styles.dot} aria-hidden="true" />{p.name.split(' ')[0]}
          {p.typing ? <span className={styles.qmuted}> píše…</span> : null}
        </span>
      ))}
    </span>
  );
}

/** Karta času v případu: kroužek s vaším časem a rozpis. */
export function CaseClock({ mine, total, others }: { mine: number; total: number; others: Array<{ name: string; minutes: number }> }) {
  const { data, active, caseId } = useContext(Ctx);
  const live = caseId && data ? data : null;
  const m = live?.mine ?? mine;
  const t = Math.max(live?.total ?? total, m);
  const pct = t ? Math.min(100, (m / t) * 100) : 0;
  const split = [`vy ${Math.round(m)}`, ...others.filter((o) => o.minutes >= 1).map((o) => `${o.name} ${Math.round(o.minutes)}`)];
  return (
    <section className={`${styles.box} ${styles.clockBox}`} aria-label="Čas na případu">
      <span className={styles.ring} style={{ background: `conic-gradient(var(--accent) ${pct}%, var(--line) 0)` }}>
        <span className={styles.ringIn}>{hm(m)}</span>
      </span>
      <span className={styles.clockText}>
        <strong className={styles.clockLive}>
          <span className={`${styles.dot} ${active ? styles.dotLive : styles.dotOff}`} aria-hidden="true" />
          {active ? 'Počítá se váš čas' : 'Čas stojí (5 min bez aktivity)'}
        </strong>
        <span className={styles.small}>Na případu celkem {Math.round(t)} min · {split.join(', ')}</span>
      </span>
    </section>
  );
}
