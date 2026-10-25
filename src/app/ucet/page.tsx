import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = { title: 'Účet' };

export default async function AccountPage() {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/ucet');
  const supabase = await createClient();
  const { data: profile } = await supabase.from('profiles').select('display_name, kind, country').eq('id', user.id).single();

  return (
    <div className="container section" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 className="t-heading-l">Účet</h1>
        <p className="muted">Přihlášeni jako {user.email}</p>
      </div>
      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Profil prodejce</h2>
        {profile ? <ProfileForm profile={profile} /> : <p className="muted">Profil se nepodařilo načíst.</p>}
      </section>
    </div>
  );
}
