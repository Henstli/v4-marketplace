import { cache } from 'react';
import { isSupabaseConfigured } from './supabase/config';
import { createClient } from './supabase/server';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  /** Správce webu (schvaluje návrhy karet) */
  isAdmin: boolean;
}

export interface SignedInUser {
  id: string;
  email: string;
}

// Přihlášení ověří podpis tokenu z cookie lokálně (klíče ES256), bez dotazu na server Supabase.
// cache() zajistí, že hlavička i stránka v jednom požadavku ověřují jen jednou.
export const getSignedInUser = cache(async (): Promise<SignedInUser | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : '' };
});

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const user = await getSignedInUser();
  if (!user) return null;
  const supabase = await createClient();
  const [{ data: profile }, { data: isAdmin }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    supabase.rpc('is_admin'),
  ]);
  return {
    id: user.id,
    email: user.email,
    displayName: profile?.display_name ?? user.email.split('@')[0] ?? 'Sběratel',
    isAdmin: isAdmin === true,
  };
});
