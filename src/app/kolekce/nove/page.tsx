import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { NewAlbumWizard } from './NewAlbumWizard';

export const metadata: Metadata = { title: 'Nové album' };

export default async function NewAlbumPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/kolekce/nove');
  const sada = one('sada');
  // Otevřeno ze Sbírky u sady (Založit kolekci): sada, název, stažení z prodeje a doplňování už jsou vybrané.
  const preset = sada ? { setId: sada, name: one('nazev'), unsell: one('prodej') === '1', autoFill: one('samo') !== '0' } : undefined;
  return <NewAlbumWizard key={sada ?? 'new'} preset={preset} />;
}
