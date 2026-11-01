'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/browser';

/** Stav Online: dokud je stránka otevřená a vidět, každé 2 minuty dá databázi vědět, že tu uživatel je. */
export function PresencePing() {
  useEffect(() => {
    const supabase = createClient();
    const ping = () => { if (document.visibilityState === 'visible') supabase.rpc('touch_presence').then(() => {}, () => {}); };
    ping();
    const t = window.setInterval(ping, 120_000);
    document.addEventListener('visibilitychange', ping);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', ping); };
  }, []);
  return null;
}
