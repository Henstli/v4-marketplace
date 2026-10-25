import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Košík' };

export default function Page() {
  return <ComingSoon title="Košík" text="Košík rozdělený podle prodejců a objednávky přidáme v dalším kroku." />;
}
