import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatPrice } from '@/lib/format';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';
import { loadShipping, type ShipOrder } from '../ship';
import { loadCtx } from '../team';
import { PrintButton } from './PrintButton';

export const metadata: Metadata = { title: 'Tisk', robots: { index: false } };

type Props = { searchParams: Promise<{ druh?: string; o?: string; obchod?: string }> };

/** Tisk z K odeslání: dodací listy (co je v balíku) a adresní štítky (zásilky na adresu). */
export default async function PrintPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/prodat?zalozka=odeslat');
  const { druh, o, obchod } = await searchParams;
  const want = new Set((o ?? '').split(',').map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100));
  const supabase = await createClient();
  // Sklad obchodu, kde je přihlášený v týmu (?obchod=…): tiskne za obchod.
  const ctx = await loadCtx(supabase, user, obchod);
  if (!ctx.perms.has('ord')) redirect('/prodat');
  const [{ orders }, { data: page }] = await Promise.all([
    loadShipping(supabase, ctx.owner),
    supabase.from('shop_pages').select('store, contact').eq('user_id', ctx.owner).maybeSingle(),
  ]);
  const labels = druh === 'adresy';
  const list = orders.filter((x) => want.has(x.number) && (!labels || (x.delivery === 'ship' && x.address && !x.address.point_name)));
  const store = (page?.store ?? {}) as { address?: string };
  const contact = (page?.contact ?? {}) as { email?: string; phone?: string; web?: string };
  const sender = { name: ctx.ownerName, address: store.address ?? '', contact: [contact.email, contact.phone, contact.web].filter(Boolean).join(' · ') };

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="tz-stk-shiphead tz-stk-noprint">
        <div><b>{labels ? 'Adresní štítky' : 'Dodací listy'} · {list.length}</b></div>
        <div className="tz-stk-hacts"><a className="tz-btn tz-btn-ghost tz-btn-md" href={`/prodat?zalozka=odeslat${ctx.q ? `&${ctx.q}` : ''}`}>← K odeslání</a><PrintButton /></div>
      </div>
      {!list.length ? <div className="tz-stk-empty"><b>Nic k tisku</b>Objednávky už jsou odeslané nebo nepatří k vašemu skladu.</div> : null}
      <div className="tz-stk-print">
        {labels ? (
          <div className="tz-stk-labels">
            {list.map((x) => <AddressLabel key={x.id} o={x} sender={sender} />)}
          </div>
        ) : list.map((x) => <PackingSlip key={x.id} o={x} sender={sender} />)}
      </div>
      {labels ? <p className="t-small muted tz-stk-noprint">Štítky jsou jen pro zásilky na adresu (Česká pošta, doporučený dopis, kurýr). Zásilky na výdejní místo potřebují štítek dopravce z vašeho účtu.</p> : null}
    </div>
  );
}

type Sender = { name: string; address: string; contact: string };

function PackingSlip({ o, sender }: { o: ShipOrder; sender: Sender }) {
  const d = o.address;
  const place = d?.point_name ? `${d.point_name}${d.point_address ? `, ${d.point_address}` : ''}` : d ? [d.street, [d.zip, d.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : 'Osobní předání';
  const n = o.items.reduce((s, i) => s + i.qty, 0);
  return (
    <article className="tz-stk-paper">
      <header>
        <div><b>Dodací list</b><span>Objednávka č. {o.number} · {formatDate(o.createdAt)}</span></div>
        <div className="tz-stk-paper-from"><b>{sender.name}</b>{sender.address ? <span>{sender.address}</span> : null}{sender.contact ? <span>{sender.contact}</span> : null}</div>
      </header>
      <div className="tz-stk-paper-to">
        <div><small>Příjemce</small><b>{o.buyer}</b><span>{o.carrierName}, {place}</span></div>
        <div><small>Objednáno přes</small><b>V4cards</b><span>{n} {n === 1 ? 'karta' : n < 5 ? 'karty' : 'karet'}</span></div>
      </div>
      <div className="tz-stk-paper-items">
        <div className="tz-stk-paper-ih"><b>Obsah balíku</b><span>zkontrolujte prosím</span></div>
        {o.items.map((i) => (
          <div key={i.key} className="tz-stk-paper-row">
            <span className="tz-stk-paper-ck" />
            <span className="tz-stk-code">{i.qty}×</span>
            <span><b>{i.name}</b><small>{i.set} · {i.condition}{i.language ? ` · ${LANGUAGE_NAMES[i.language as Language] ?? i.language}` : ''}</small></span>
            <span className="tz-stk-code">{formatPrice(i.price * i.qty)}</span>
          </div>
        ))}
        <div className="tz-stk-paper-row is-sum"><span /><span /><span>Celkem s dopravou{o.payment === 'cod' ? ' (dobírka)' : ''}</span><b className="tz-stk-code">{formatPrice(o.total)}</b></div>
      </div>
      <footer><b>Děkujeme za nákup!</b><span>Něco chybí nebo nesedí? Napište nám přes zprávy na V4cards.</span></footer>
    </article>
  );
}

function AddressLabel({ o, sender }: { o: ShipOrder; sender: Sender }) {
  const d = o.address!;
  return (
    <div className="tz-stk-label">
      <small>Odesílatel: {sender.name}{sender.address ? `, ${sender.address}` : ''}</small>
      <b>{d.recipient}</b>
      <span>{d.street}</span>
      <span>{[d.zip?.replace(/^(\d{3})(\d{2})$/, '$1 $2'), d.city].filter(Boolean).join(' ')}{d.country === 'SK' ? ', Slovensko' : ''}</span>
      {d.phone ? <span className="tz-stk-code">{d.phone}</span> : null}
      <em className="tz-stk-code">č. {o.number}{o.payment === 'cod' ? ` · dobírka ${formatPrice(o.total)}` : ''}</em>
    </div>
  );
}
