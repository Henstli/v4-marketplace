import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Prodat karty' };

export default function Page() {
  return <ComingSoon title="Prodat karty" text="Vystavení karet k prodeji, jednotlivě i hromadně, přidáme v dalším kroku." />;
}
