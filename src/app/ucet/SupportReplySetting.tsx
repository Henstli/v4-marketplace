'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import styles from '@/components/auth/auth.module.css';

/** Kudy posílat odpovědi podpory (DS Support › Chat s podporou). Uloží se hned po výběru. */
export function SupportReplySetting({ initial }: { initial: 'app' | 'email' }) {
  const [via, setVia] = useState(initial);
  const [state, setState] = useState<'' | 'ok' | string>('');
  async function choose(v: 'app' | 'email') {
    setVia(v);
    const { error } = await createClient().rpc('set_support_reply_via', { p_via: v });
    setState(error ? error.message : 'ok');
  }
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <legend className="t-label muted" style={{ marginBottom: 'var(--space-2)' }}>ODPOVĚDI PODPORY POSÍLAT</legend>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input type="radio" name="support_reply_via" checked={via === 'app'} onChange={() => void choose('app')} style={{ accentColor: 'var(--accent)', marginTop: 4 }} />
        <span>V aplikaci <span className="muted">(chat vpravo dole; e-mail, když zprávu do 30 minut nepřečtete)</span></span>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input type="radio" name="support_reply_via" checked={via === 'email'} onChange={() => void choose('email')} style={{ accentColor: 'var(--accent)', marginTop: 4 }} />
        <span>E-mailem <span className="muted">(hned, odpověď najdete i v chatu)</span></span>
      </label>
      {state === 'ok' ? <p className="t-small muted" role="status">Uloženo.</p> : state ? <p className={styles.error} role="alert">{state}</p> : null}
    </fieldset>
  );
}
