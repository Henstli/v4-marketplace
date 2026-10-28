'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/** Hlavička a patička webu; v režimu podpory se neukazují (DS Support, Režim podpory). */
export function SiteChrome({ children }: { children: ReactNode }) {
  const path = usePathname();
  return path.startsWith('/sprava/podpora') ? null : <>{children}</>;
}
