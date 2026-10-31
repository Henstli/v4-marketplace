import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getAlbum } from '@/lib/collection';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { AlbumScreen } from './AlbumScreen';

export const metadata: Metadata = { title: 'Album' };

export default async function AlbumPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ zalozeno?: string }> }) {
  if (!isSupabaseConfigured()) redirect('/');
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/prihlaseni?dalsi=/kolekce/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const album = await getAlbum(id);
  if (!album) notFound();
  const { zalozeno } = await searchParams;
  return <AlbumScreen album={album} founding={zalozeno !== undefined} />;
}
