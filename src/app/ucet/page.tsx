import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { identityMethod } from '@/lib/identity';
import { EmailSettings } from './EmailSettings';
import { MfaSettings } from './MfaSettings';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = { title: 'Účet' };

type Props = { searchParams: Promise<{ heslo?: string; email?: string }> };

const EMAIL_NOTICES: Record<string, string> = {
  druhy: 'Jeden odkaz je potvrzený. Změnu dokončíte odkazem z druhého e-mailu.',
  zmenen: 'Nový e-mail je potvrzený a platí pro přihlášení.',
};

export default async function AccountPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/ucet');
  const supabase = await createClient();
  const [{ data: profile }, { data: factors }, method, { heslo, email }] = await Promise.all([
    supabase.from('profiles').select('display_name, kind, country').eq('id', user.id).single(),
    supabase.auth.mfa.listFactors(),
    identityMethod(supabase),
    searchParams,
  ]);
  const mfaEnabled = (factors?.totp.length ?? 0) > 0;

  return (
    <div className="container section" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 className="t-heading-l">Účet</h1>
        <p className="muted">Přihlášeni jako {user.email}</p>
        <p className="t-small">
          <Link href="/prodat/nova-karta">Moje návrhy karet</Link>
          {user.isAdmin ? <> · <Link href="/sprava/karty">Schvalování karet</Link></> : null}
        </p>
      </div>
      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Profil prodejce</h2>
        {profile ? <ProfileForm profile={profile} /> : <p className="muted">Profil se nepodařilo načíst.</p>}
      </section>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h2 className="t-heading-m">Zabezpečení</h2>
        {heslo ? <p className="muted" role="status">Nové heslo je uložené.</p> : null}
        {email && EMAIL_NOTICES[email] ? <p className="muted" role="status">{EMAIL_NOTICES[email]}</p> : null}
        <div>
          <h3 className="t-label muted" style={{ marginBottom: 'var(--space-2)' }}>E-MAIL</h3>
          <EmailSettings email={user.email} method={method} />
        </div>
        <div>
          <h3 className="t-label muted">HESLO</h3>
          <p><Link href="/nove-heslo">{method === 'password' ? 'Změnit heslo' : 'Nastavit heslo'}</Link></p>
        </div>
        <div>
          <h3 className="t-label muted" style={{ marginBottom: 'var(--space-2)' }}>DVOUFÁZOVÉ OVĚŘENÍ</h3>
          <MfaSettings enabled={mfaEnabled} />
        </div>
      </section>
    </div>
  );
}
