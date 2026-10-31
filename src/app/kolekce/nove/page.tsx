import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { NewAlbumWizard } from './NewAlbumWizard';

export const metadata: Metadata = { title: 'Nové album' };

export default async function NewAlbumPage() {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/kolekce/nove');
  return <NewAlbumWizard />;
}
