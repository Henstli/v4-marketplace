'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Obnoví data stránky každou minutu a po návratu do okna. */
export function AutoRefresh({ every = 60000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') router.refresh(); };
    const t = setInterval(refresh, every);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router, every]);
  return null;
}
