import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import styles from '@/components/auth/auth.module.css';
import { safeNext } from '@/lib/auth-helpers';
import { getPendingLogin } from '@/lib/devices';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { CodeForm } from './CodeForm';

export const metadata: Metadata = { title: 'Ověření přihlášení' };

type Props = { searchParams: Promise<{ dalsi?: string }> };

export default async function LoginCodePage({ searchParams }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const next = safeNext((await searchParams).dalsi);
  const email = await getPendingLogin();
  if (!email) redirect(`/prihlaseni?dalsi=${encodeURIComponent(next)}`);

  return (
    <div className="container section">
      <div className={`panel ${styles.wrap}`}>
        <div>
          <h1 className="t-heading-l">Ověření přihlášení</h1>
          <p className="muted">
            Přihlašujete se z nového zařízení nebo prohlížeče. Pro jistotu jsme na {email} poslali kód. Zadejte ho sem a toto
            zařízení si zapamatujeme.
          </p>
        </div>
        <CodeForm next={next} />
        <p className="t-small muted">
          Kód nepřišel? Zkontrolujte spam. <Link href="/prihlaseni">Zpět na přihlášení</Link>
        </p>
      </div>
    </div>
  );
}
