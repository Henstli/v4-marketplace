import type { Metadata } from 'next';
import Link from 'next/link';
import { ContentReportForm } from '@/components/reports/ReportContent';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Nahlásit nezákonný obsah' };

type Props = { searchParams: Promise<{ odkaz?: string }> };

// Nahlášení z patičky (DSA čl. 16): jde i bez přihlášení, pak se ptáme na jméno a e-mail.
export default async function ReportPage({ searchParams }: Props) {
  const [{ odkaz }, user] = await Promise.all([searchParams, getCurrentUser()]);
  return (
    <div className="container" style={{ maxWidth: 640, paddingBlock: 32 }}>
      <h1 className="t-heading-l">Nahlásit nezákonný obsah</h1>
      <p className="muted" style={{ margin: '8px 0 24px' }}>
        Narazili jste na V4cards na padělek, podvod nebo jiný nezákonný obsah? Pošlete nám odkaz a popis. Konkrétní nabídku,
        prodejce, zprávu nebo hodnocení můžete nahlásit i přímo u nich. S objednávkou pomůže <Link href="/objednavky">hlášení u objednávky</Link>.
      </p>
      <div className="panel">
        <ContentReportForm kind="other" contact={!user} defaultUrl={odkaz?.startsWith('http') ? odkaz.slice(0, 500) : undefined} />
      </div>
    </div>
  );
}
