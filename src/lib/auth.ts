import { isSupabaseConfigured } from './supabase/config';
import { createClient } from './supabase/server';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  /** Správce webu (schvaluje návrhy karet) */
  isAdmin: boolean;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const [{ data: profile }, { data: isAdmin }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', data.user.id).maybeSingle(),
    supabase.rpc('is_admin'),
  ]);
  return {
    id: data.user.id,
    email: data.user.email ?? '',
    displayName: profile?.display_name ?? data.user.email?.split('@')[0] ?? 'Sběratel',
    isAdmin: isAdmin === true,
  };
}
