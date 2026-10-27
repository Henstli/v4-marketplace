import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ButtonLink, SellerBadge, ShopLogo, shopStyle } from '@/components/trezor';
import { Icon } from '@/components/account/AccountNav';
import { getAccountSummary } from '@/lib/account';
import { PLANS } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export const metadata: Metadata = { title: 'Můj profil' };

const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

// Přehled centra účtu: stav stránky a co na uživatele čeká.
export default async function AccountOverviewPage() {
  if (!isSupabaseConfigured()) redirect('/');
  const a = await getAccountSummary();
  if (!a) redirect('/prihlaseni?dalsi=/ucet');

  const pageState = !a.shopPage
    ? `Základní profil · vlastní stránka je v tarifech Plus a Pro`
    : a.published
      ? `Stránka je zveřejněná${a.draft ? ' · máte neuložený koncept' : ''}`
      : a.draft ? 'Stránka zatím není zveřejněná · máte rozpracovaný koncept' : 'Stránka zatím není zveřejněná';

  return (
    <div>
      <h1 className="t-heading-l">Přehled</h1>
      <p className="muted" style={{ margin: '4px 0 var(--space-6)' }}>Co se děje ve vašem {a.kind === 'shop' ? 'obchodě' : 'profilu'} a nákupech.</p>

      <div className="tz-acct-hero">
        <span style={shopStyle(a.color)}><ShopLogo name={a.name} image={a.logo} size={56} /></span>
        <div>
          <div className="tz-acct-name" style={{ fontSize: 17 }}>
            <span>{a.name}</span>
            {a.plan === 'pro' ? <SellerBadge type="pro" /> : null}
            {a.badge ? <SellerBadge type="verified" /> : null}
          </div>
          <p className="tz-acct-sub" style={{ whiteSpace: 'normal' }}>{pageState}</p>
        </div>
        <div className="tz-acct-hero-actions">
          {a.shopPage
            ? <ButtonLink href="/ucet/stranka" variant="secondary">Upravit stránku</ButtonLink>
            : <ButtonLink href="/ucet/predplatne" variant="secondary">Tarify</ButtonLink>}
          <ButtonLink href={a.href}>{a.shopPage ? (a.kind === 'shop' ? 'Zobrazit obchod' : 'Zobrazit stránku') : 'Zobrazit profil'}</ButtonLink>
        </div>
      </div>

      <div className="tz-acct-tiles">
        <Link href="/objednavky" className="tz-acct-tile">
          <span className="tz-acct-tile-title"><Icon name="orders" />Prodeje k vyřízení</span>
          <span className="tz-acct-tile-num">{a.toShip}</span>
          {a.toShip ? `${plural(a.toShip, 'Objednávka čeká', 'Objednávky čekají', 'Objednávek čeká')} na potvrzení nebo odeslání` : 'Nic nečeká na vyřízení'}
          <span className="tz-acct-tile-link">Objednávky</span>
        </Link>
        <Link href="/objednavky" className="tz-acct-tile">
          <span className="tz-acct-tile-title"><Icon name="orders" />Rozpracované nákupy</span>
          <span className="tz-acct-tile-num">{a.toConfirm}</span>
          {a.toConfirm ? 'Po převzetí karet to potvrďte' : 'Žádný nákup neprobíhá'}
          <span className="tz-acct-tile-link">Objednávky</span>
        </Link>
        <Link href="/prodat" className="tz-acct-tile">
          <span className="tz-acct-tile-title"><Icon name="offers" />Nabídky</span>
          <span className="tz-acct-tile-num">{a.listings.toLocaleString('cs-CZ')}</span>
          {plural(a.listings, 'aktivní nabídka', 'aktivní nabídky', 'aktivních nabídek')}
          <span className="tz-acct-tile-link">{a.listings ? 'Spravovat' : 'Vystavit kartu'}</span>
        </Link>
        <div className="tz-acct-tile">
          <span className="tz-acct-tile-title"><Icon name="coll" />Sbírka</span>
          <span className="tz-acct-tile-num">Brzy</span>
          Evidence vašich karet a jejich hodnoty
        </div>
        <div className="tz-acct-tile">
          <span className="tz-acct-tile-title"><Icon name="wish" />Wishlist</span>
          <span className="tz-acct-tile-num">Brzy</span>
          Karty, které sháníte, a upozornění na nové nabídky
        </div>
        <Link href="/ucet/predplatne" className="tz-acct-tile">
          <span className="tz-acct-tile-title"><Icon name="plan" />Předplatné</span>
          <span className="tz-acct-tile-num">{PLANS[a.plan].name}</span>
          {a.plan === 'free' ? 'Vlastní stránka a logo u nabídek jsou v Plus a Pro' : 'Váš tarif a co obsahuje'}
          <span className="tz-acct-tile-link">Podrobnosti</span>
        </Link>
      </div>
    </div>
  );
}
