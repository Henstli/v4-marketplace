import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { identityMethod } from '@/lib/identity';
import { EmailSettings } from '../../EmailSettings';
import { MfaSettings } from '../../MfaSettings';
import { czAccountNumber } from '@/lib/payment';
import { ProfileForm } from '../../ProfileForm';
import { SellerTermsForm } from '../../SellerTermsForm';

export const metadata: Metadata = { title: 'Nastavení účtu' };

type Props = { searchParams: Promise<{ heslo?: string; email?: string }> };

const EMAIL_NOTICES: Record<string, string> = {
  druhy: 'Jeden odkaz je potvrzený. Změnu dokončíte odkazem z druhého e-mailu.',
  zmenen: 'Nový e-mail je potvrzený a platí pro přihlášení.',
};

export default async function AccountPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/ucet/nastaveni');
  const supabase = await createClient();
  const [{ data: profile }, { data: payment }, { data: factors }, method, { heslo, email }] = await Promise.all([
    supabase.from('profiles').select('display_name, kind, country, shipping_czk, free_shipping_from, pickup, pickup_place').eq('id', user.id).single(),
    supabase.from('seller_payment').select('iban, account_name').eq('user_id', user.id).maybeSingle(),
    supabase.auth.mfa.listFactors(),
    identityMethod(supabase),
    searchParams,
  ]);
  const mfaEnabled = (factors?.totp.length ?? 0) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 className="t-heading-l">Nastavení účtu</h1>
        <p className="muted">Přihlášeni jako {user.email}</p>
      </div>
      <section className="panel">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Profil prodejce</h2>
        {profile ? <ProfileForm profile={profile} /> : <p className="muted">Profil se nepodařilo načíst.</p>}
      </section>
      <section className="panel" id="doprava-platba">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Doprava a platba</h2>
        {profile ? (
          <SellerTermsForm
            terms={{
              shipping_czk: profile.shipping_czk,
              free_shipping_from: profile.free_shipping_from,
              pickup: profile.pickup,
              pickup_place: profile.pickup_place,
              account: payment ? czAccountNumber(payment.iban) ?? payment.iban : '',
              account_name: payment?.account_name ?? '',
            }}
          />
        ) : null}
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
