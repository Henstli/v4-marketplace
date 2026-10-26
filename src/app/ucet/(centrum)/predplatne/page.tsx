import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAccountSummary } from '@/lib/account';
import { PLANS, type Plan } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export const metadata: Metadata = { title: 'Předplatné' };

const ROWS: { label: string; has: (p: Plan) => boolean | string }[] = [
  { label: 'Prodej karet a základní profil', has: () => true },
  { label: 'Vlastní stránka s adresou /obchod/…', has: (p) => PLANS[p].shopPage },
  { label: 'Bloky na stránce', has: (p) => (PLANS[p].maxBlocks ? `až ${PLANS[p].maxBlocks}` : false) },
  { label: 'Logo u nabídek a odznak Ověřený prodejce (po ověření)', has: (p) => PLANS[p].offerLogo },
  { label: 'Šablony, písma, efektní barvy a bloky Pro', has: (p) => PLANS[p].fullDesign },
  { label: 'Zvýraznění u nabídek a štítek PRO', has: (p) => PLANS[p].offerHighlight },
  { label: 'Hromadné nahrávání nabídek', has: (p) => PLANS[p].bulkImport },
];

export default async function SubscriptionPage() {
  if (!isSupabaseConfigured()) redirect('/');
  const a = await getAccountSummary();
  if (!a) redirect('/prihlaseni?dalsi=/ucet/predplatne');
  const plans: Plan[] = ['free', 'plus', 'pro'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 className="t-heading-l">Předplatné</h1>
        <p className="muted">Váš tarif: <b style={{ color: 'var(--ink)' }}>{PLANS[a.plan].name}</b>. Placené tarify zatím přiděluje správce, o změnu napište na <a href="mailto:podpora@v4cards.com">podpora@v4cards.com</a>.</p>
      </div>
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 12px 12px 0' }} />
              {plans.map((p) => (
                <th key={p} style={{ textAlign: 'center', padding: '8px 12px 12px', color: p === a.plan ? 'var(--accent)' : undefined }}>
                  {PLANS[p].name}{p === a.plan ? <div className="t-small muted">váš tarif</div> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '10px 12px 10px 0' }}>{r.label}</td>
                {plans.map((p) => {
                  const v = r.has(p);
                  return <td key={p} style={{ textAlign: 'center', padding: '10px 12px', color: v ? 'var(--ink)' : 'var(--ink-muted)' }}>{typeof v === 'string' ? v : v ? '✓' : '–'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
