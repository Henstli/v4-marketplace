import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Přihlášení' };

export default function Page() {
  return <ComingSoon title="Přihlášení" text="Registrace a přihlášení e-mailem přidáme v dalším kroku." />;
}
