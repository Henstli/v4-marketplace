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
import type { Carrier } from '@/lib/delivery';
import { ProfileForm } from '../../ProfileForm';
import { DeliveryPaymentForm } from '../../DeliveryPaymentForm';
import { deleteSavedAddress } from '@/app/kosik/actions';
import { Button } from '@/components/trezor';

export const metadata: Metadata = { title: 'Nastavení účtu' };

type Props = { searchParams: Promise<{ heslo?: string; email?: string; zpet?: string }> };

const EMAIL_NOTICES: Record<string, string> = {
  druhy: 'Jeden odkaz je potvrzený. Změnu dokončíte odkazem z druhého e-mailu.',
  zmenen: 'Nový e-mail je potvrzený a platí pro přihlášení.',
};

export default async function AccountPage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/ucet/nastaveni');
  const supabase = await createClient();
  const [{ data: profile }, { data: payment }, { data: methods }, { data: factors }, method, { heslo, email, zpet }, { data: rates }, { data: address }] = await Promise.all([
    supabase.from('profiles')
      .select('display_name, kind, country, free_shipping_from, pickup, pickup_place, pay_transfer, cash_on_pickup, pickup_lat, pickup_lng, pickup_radius_km, pickup_exact')
      .eq('id', user.id).single(),
    supabase.from('seller_payment').select('iban, account_name').eq('user_id', user.id).maybeSingle(),
    supabase.from('seller_shipping_methods').select('carrier, label, price_czk, cod, cod_fee_czk').eq('seller_id', user.id),
    supabase.auth.mfa.listFactors(),
    identityMethod(supabase),
    searchParams,
    supabase.from('carrier_rates').select('carrier, price_czk, cod_fee_czk, heavy_czk'),
    supabase.from('buyer_addresses').select('recipient, phone, street, city, zip, country').eq('user_id', user.id).maybeSingle(),
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
      <section id="doprava-platba">
        <h2 className="t-heading-m" style={{ marginBottom: 'var(--space-4)' }}>Doprava a platba</h2>
        {profile ? (
          <DeliveryPaymentForm
            back={zpet === 'prodat' ? '/prodat' : zpet === 'import' ? '/prodat/import' : undefined}
            values={{
              transfer: profile.pay_transfer && !!payment,
              account: payment ? czAccountNumber(payment.iban) ?? payment.iban : '',
              accountName: payment?.account_name ?? '',
              cashOnPickup: profile.cash_on_pickup,
              pickup: profile.pickup,
              pickupPlace: profile.pickup_place ?? '',
              pickupLat: profile.pickup_lat,
              pickupLng: profile.pickup_lng,
              pickupRadius: profile.pickup_radius_km ?? 2,
              pickupExact: profile.pickup_exact,
              freeFrom: profile.free_shipping_from,
              rates: Object.fromEntries((rates ?? []).map((r) => [r.carrier, { price: r.price_czk, codFee: r.cod_fee_czk, heavy: r.heavy_czk }])),
              methods: (methods ?? []).map((m) => ({ carrier: m.carrier as Carrier, label: m.label, price: m.price_czk, cod: m.cod, codFee: m.cod_fee_czk })),
            }}
          />
        ) : null}
      </section>
      <section id="adresa" className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 className="t-heading-m">Doručovací adresa pro nákupy</h2>
        {address ? (
          <>
            <p>
              <strong>{address.recipient}</strong>
              {address.street ? <><br />{address.street}, {address.zip} {address.city}, {address.country === 'SK' ? 'Slovensko' : 'Česko'}</> : null}
              {address.phone ? <><br /><span className="code">{address.phone}</span></> : null}
            </p>
            <p className="t-small muted">Vidíte ji jen vy. V košíku se vyplní sama, prodejce ji dostane až u potvrzené objednávky.</p>
            <form action={deleteSavedAddress}><Button type="submit" variant="ghost">Smazat uloženou adresu</Button></form>
          </>
        ) : (
          <p className="muted">Nemáte uloženou adresu. Uložit ji můžete v košíku při objednávce.</p>
        )}
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
