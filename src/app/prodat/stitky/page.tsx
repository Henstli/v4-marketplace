import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { getCurrentUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadStock } from '../data';
import { kc, langCode } from '../sk';
import { loadCtx } from '../team';
import { PrintButton } from './PrintButton';

export const metadata: Metadata = { title: 'Štítky karet', robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tisk štítků vybraných karet skladu: název, sada, stav, cena, umístění a QR odkaz na kartu. */
export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ ids?: string; obchod?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/prodat');
  const supabase = await createClient();
  const ctx = await loadCtx(supabase, user, sp.obchod);
  if (!ctx.perms.has('view')) redirect('/prodat');
  const ids = new Set(String(sp.ids ?? '').split(',').filter((x) => UUID.test(x)).slice(0, 200));
  const rows = (await loadStock(supabase, ctx.owner)).filter((r) => ids.has(r.id) && r.card);
  const labels = await Promise.all(rows.map(async (r) => ({
    r,
    qr: await QRCode.toString(`https://www.v4cards.com/karty/${r.card!.slug}`, { type: 'svg', margin: 0, width: 74 }),
  })));
  return (
    <div className="tz-sk"><div className="wrap">
      <style>{`@media print{header,footer,nav,.noprint{display:none!important}body{background:#fff!important}.tz-sk .wrap{padding:0!important}}
        .tz-sk .qrp{margin-top:16px}.tz-sk .qrc{background:#fff;break-inside:avoid}.tz-sk .qrc svg{width:74px;height:74px;flex:none}.tz-sk .qrc b{font-size:15px!important;line-height:1.2}`}</style>
      <div className="top noprint">
        <div><h1>Štítky karet</h1><p className="ilead" style={{ margin: 0 }}>{rows.length ? `${rows.length} štítků, na A4 se vejde 24.` : 'Vyberte karty v tabulce a dejte Štítky.'}</p></div>
        <div className="acts">{rows.length ? <PrintButton /> : null}</div>
      </div>
      <div className="qrp">
        {labels.map(({ r, qr }) => (
          <div key={r.id} className="qrc">
            <span dangerouslySetInnerHTML={{ __html: qr }} style={{ display: 'contents' }} />
            <div>
              <b>{r.card!.name}</b>
              <small>{r.card!.setCode} {r.card!.number} · {r.condition} · {langCode(r.language)}</small>
              <span>{r.price != null ? kc(r.price) : 'Cena dohodou'}{r.location ? ` · ${r.location}` : ''}</span>
            </div>
          </div>
        ))}
      </div>
    </div></div>
  );
}
