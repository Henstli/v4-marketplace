import Link from 'next/link';
import QRCode from 'qrcode';
import { ButtonLink, Price, Status } from '@/components/trezor';
import { formatDateTime, formatPrice } from '@/lib/format';
import { czAccountNumber, formatIban, spayd } from '@/lib/payment';
import { OFFER, REASON, reportCode, reportLabel, turnOf, type ReportFile, type ReportRow } from '@/lib/reports';
import { AddFiles } from './AddFiles';
import { OfferForm } from './OfferForm';
import { Step } from './Step';
import styles from './reports.module.css';

const VIA_NAME = { bank: 'převodem', paypal: 'přes PayPal', revolut: 'přes Revolut' } as const;

function offerText(r: ReportRow): string {
  const czk = formatPrice(r.offer_czk ?? 0);
  switch (r.offer_kind) {
    case 'partial': return `Dorovnání · ${czk}`;
    case 'difference': return `Rozdíl ceny · ${czk}`;
    case 'return': return `Vrácení karty · ${czk} + zpáteční doprava`;
    case 'refund_keep': return `Peníze bez vrácení karty · ${czk}`;
    default: return '';
  }
}

/** Detail hlášení pro strany sporu i podporu (DS Reports, obrazovky 4–6). */
export async function ReportPanel({ r, me, files, otherName, admin = false }: { r: ReportRow; me: string; files: ReportFile[]; otherName: string; admin?: boolean }) {
  const o = r.orders;
  const buyer = o?.buyer_id === me;
  const seller = o?.seller_id === me;
  const party = buyer || seller;
  const open = r.status !== 'closed';
  const label = reportLabel(r, me);
  const turn = turnOf(r);
  const items = o ? o.total_czk - o.shipping_czk : 0;
  const pay = (r.offer_czk ?? 0) + (r.return_cost_czk ?? 0);
  const mineFiles = files.filter((f) => f.uploader_id === me).length;
  const dispute = r.reason === 'not_as_described';
  const qr = r.payout_bank?.startsWith('CZ') && seller && r.status === 'agreed' && !r.comp_sent_at
    ? await QRCode.toString(spayd({ iban: r.payout_bank, amount: pay, vs: o?.number ?? r.number, name: 'Kupujici' }), { type: 'svg', margin: 1, width: 132 })
    : null;

  return (
    <section className={styles.box} aria-labelledby="hlaseni">
      <div className={styles.head}>
        <h1 id="hlaseni" className="t-heading-l">Hlášení {reportCode(r.number)}</h1>
        <Status tone={label.tone}>{label.text}</Status>
      </div>
      <p className="t-small muted">
        {REASON[r.reason]} · {o ? <Link href={`/objednavky/${o.number}`}>Objednávka č. {o.number}</Link> : 'objednávka'} · {admin ? otherName : `${r.reporter_id === me ? (buyer ? 'prodejce' : 'kupující') : 'nahlásil(a)'} ${otherName}`} · {formatDateTime(r.created_at)}
      </p>

      <ol className={styles.track}>
        <li data-done=""><span>Odesláno</span><span className="muted">{formatDateTime(r.created_at)}</span></li>
        <li data-done={!open ? '' : undefined} data-now={open ? '' : undefined}><span>{turn === 'support' || !open ? 'Prověřujeme' : 'Domluva stran'}</span><span className="muted">{open && r.due_at ? `do ${formatDateTime(r.due_at)}` : ''}</span></li>
        <li data-done={!open ? '' : undefined}><span>Uzavřeno</span><span className="muted">{r.closed_at ? formatDateTime(r.closed_at) : ''}</span></li>
      </ol>

      <div className={styles.rows}>
        <span className="t-label muted">{r.reporter_id === me ? 'VÁŠ POPIS' : 'POPIS'}</span>
        <p className={styles.quote}>{r.description}</p>
        {r.against_note ? (
          <>
            <span className="t-label muted">VYJÁDŘENÍ {r.reporter_role === 'buyer' ? 'PRODEJCE' : 'KUPUJÍCÍHO'} · {formatDateTime(r.against_note_at!)}</span>
            <p className={styles.quote}>{r.against_note}</p>
          </>
        ) : null}
      </div>

      {r.support_note ? (
        <div className={styles.support}>
          <span className="t-label">VYJÁDŘENÍ PODPORY · {formatDateTime(r.support_note_at!)}</span>
          <span style={{ whiteSpace: 'pre-line' }}>{r.support_note}</span>
          <span className="t-small muted">Nezávazné doporučení podpory V4cards.</span>
        </div>
      ) : null}

      {open && r.against_id === me && !r.against_note ? (
        <div className={styles.notice}>
          <strong>K objednávce je otevřené hlášení</strong>
          <span className="t-small">Podpora V4cards případ prověřuje. Vyjádřete se a přiložte podklady (výpis plateb, podací lístek, fotky). Pokud se ukáže, že jste porušili podmínky, můžeme omezit nebo zablokovat účet.</span>
          <Step id={r.id} op="reply" label="Odeslat vyjádření" variant="secondary">
            <textarea name="text" className={styles.input} maxLength={2000} rows={3} required aria-label="Vaše vyjádření" />
          </Step>
        </div>
      ) : null}

      {dispute && party && open && r.status !== 'review' ? <Dispute r={r} buyer={buyer} seller={seller} items={items} pay={pay} qr={qr} /> : null}

      <div className={styles.rows}>
        <span className="t-label muted">PŘÍLOHY{files.length ? ` · ${files.length}` : ''}</span>
        {files.length ? (
          <ul className={styles.list}>
            {files.map((f) => (
              <li key={f.id} className="t-small">
                {f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a> : f.name}
                <span className="muted"> · {f.uploader_id === me ? 'vy' : f.uploader_id === r.reporter_id ? (admin ? 'oznamovatel' : 'druhá strana') : 'druhá strana'} · {Math.max(1, Math.round(f.size / 1024))} kB</span>
              </li>
            ))}
          </ul>
        ) : <span className="t-small muted">Zatím žádné.</span>}
        {open && party ? <AddFiles report={r.id} uid={me} left={10 - mineFiles} /> : null}
      </div>

      {party ? (
        <div className={styles.rows}>
          <div className={styles.two}>
            <a href={`mailto:podpora@v4cards.com?subject=${encodeURIComponent(reportCode(r.number))}`} className="tz-btn tz-btn-secondary tz-btn-md">Napsat podpoře</a>
            {open && r.reporter_id === me ? <Step id={r.id} op="withdraw" label="Odvolat hlášení" variant="secondary" className={styles.full} /> : null}
          </div>
          {open && r.reporter_id === me ? <span className="t-small muted">Odvolejte, když se s druhou stranou domluvíte sami. Odvolané hlášení se nepočítá do profilu prodejce.</span> : null}
          {open && ['seller', 'buyer', 'agreed'].includes(r.status) ? <Step id={r.id} op="escalate" label="Předat podpoře" variant="ghost" /> : null}
        </div>
      ) : null}

      {admin ? (
        <Step id={r.id} op="admin" label="Uložit">
          <span className="t-label muted">VYJÁDŘENÍ PODPORY (UVIDÍ OBĚ STRANY)</span>
          <textarea name="note" className={styles.input} rows={4} maxLength={4000} defaultValue="" placeholder="Shrnutí podkladů a nezávazné doporučení." />
          <label className={styles.field}>
            <span className="t-small muted">Uzavřít jako</span>
            <select name="outcome" className={styles.input} defaultValue="">
              <option value="">Nechat otevřené</option>
              <option value="resolved">Vyřešeno</option>
              <option value="no_agreement">Bez dohody</option>
              <option value="violation">Porušení podmínek</option>
            </select>
          </label>
          <span className="t-small muted">Podpora nerozhoduje, kdo má pravdu. Píše jen nezávazné doporučení a rozhoduje o porušení podmínek.</span>
        </Step>
      ) : null}
    </section>
  );
}

/** Domluva u „Karta neodpovídá popisu“: nabídky, vrácení, kam poslat peníze a potvrzení. */
function Dispute({ r, buyer, seller, items, pay, qr }: { r: ReportRow; buyer: boolean; seller: boolean; items: number; pay: number; qr: string | null }) {
  const o = r.orders!;
  const myTurn = (r.status === 'seller' && seller) || (r.status === 'buyer' && buyer);
  const theirOffer = r.offer_kind && r.offer_by && r.offer_by !== (buyer ? o.buyer_id : o.seller_id);

  if (r.status === 'seller' || r.status === 'buyer') {
    return (
      <div className={styles.rows}>
        {r.offer_kind ? (
          <div className={styles.offerBox}>
            <span className="t-label">{r.offer_by === o.seller_id ? 'NABÍDKA PRODEJCE' : 'NÁVRH KUPUJÍCÍHO'}</span>
            <span className={styles.offerTitle}>{offerText(r)}</span>
            {r.offer_note ? <span className="t-small">„{r.offer_note}“</span> : null}
            {r.due_at ? <span className={`t-small ${styles.offerDue}`}>{myTurn ? 'Odpovězte' : 'Druhá strana odpoví'} do {formatDateTime(r.due_at)}</span> : null}
          </div>
        ) : !myTurn ? <p className="t-small muted">Prodejce má do {r.due_at ? formatDateTime(r.due_at) : '3 dnů'} nabídnout řešení. Bez nabídky hlášení převezme podpora.</p> : null}
        {myTurn && theirOffer ? <Step id={r.id} op="accept" label={r.offer_kind === 'return' ? 'Přijmout vrácení' : `Přijmout ${formatPrice(r.offer_czk ?? 0)}`} /> : null}
        {myTurn ? <OfferForm id={r.id} items={items} total={o.total_czk} shipping={o.shipping_czk} role={seller ? 'seller' : 'buyer'} /> : null}
        {myTurn && r.rejects >= 2 ? <p className="t-small">Nemůžete se dohodnout? Předejte hlášení podpoře.</p> : null}
      </div>
    );
  }

  // Dohoda platí: vrácení karty, kam poslat peníze, poslání a potvrzení.
  const ret = r.offer_kind === 'return';
  return (
    <div className={styles.rows}>
      <div className={styles.offerBox}>
        <span className="t-label">DOHODA · {formatDateTime(r.agreed_at!)}</span>
        <span className={styles.offerTitle}>{OFFER[r.offer_kind!]} · {formatPrice(pay)}{ret && !r.return_cost_czk ? ' + zpáteční doprava' : ''}</span>
      </div>
      {ret ? (
        <dl className={styles.sum}>
          <dt>Cena karet</dt><dd className="code">{formatPrice(items)}</dd>
          <dt>Původní doprava</dt><dd className="code">{formatPrice(o.shipping_czk)}</dd>
          <dt>Zpáteční doprava</dt><dd className="code">{r.return_cost_czk != null ? formatPrice(r.return_cost_czk) : `do ${formatPrice(o.shipping_czk)}`}</dd>
          <dt className={styles.sumTotal}>Celkem</dt><dd className={`code ${styles.sumTotal}`}>{formatPrice(pay)}</dd>
        </dl>
      ) : null}
      {ret && !r.return_sent_at ? (
        buyer ? (
          <Step id={r.id} op="return_sent" label="Karta odeslaná zpět">
            <span className="t-small">Pošlete kartu prodejci sledovanou zásilkou. Adresu vám napíše ve zprávách.</span>
            <label className={styles.field}><span className="t-small muted">Číslo zásilky</span><input name="tracking" required maxLength={60} className={`${styles.input} code`} /></label>
            <label className={styles.field}><span className="t-small muted">Cena zpáteční dopravy (nejvýš {formatPrice(o.shipping_czk)})</span><input name="cost" inputMode="numeric" max={o.shipping_czk} className={`${styles.input} code`} defaultValue={o.shipping_czk} /></label>
          </Step>
        ) : <p className="t-small muted">Kupující pošle kartu zpět sledovanou zásilkou. Napište mu ve zprávách adresu.</p>
      ) : null}
      {ret && r.return_sent_at && !r.return_received_at ? (
        <>
          <div className={styles.row}><span>Číslo zásilky</span><span className="code">{r.return_tracking}</span></div>
          {seller ? <Step id={r.id} op="return_received" label="Karta dorazila" /> : <p className="t-small muted">Prodejce potvrdí, že karta dorazila, a do 3 dnů pošle peníze.</p>}
        </>
      ) : null}
      {!r.payout_at ? (
        buyer ? (
          <Step id={r.id} op="payout" label="Poslat prodejci">
            <span className={styles.offerTitle}>Kam vám prodejce pošle {formatPrice(pay)}{ret && !r.return_cost_czk ? ' (bez zpáteční dopravy)' : ''}?</span>
            <span className="t-small muted">Vyplňte aspoň jeden způsob. Prodejce si vybere, který mu vyhovuje.</span>
            <label className={styles.field}><span className="t-small muted">Bankovní účet</span><input name="bank" className={`${styles.input} code`} placeholder="123456789/0800" /></label>
            <label className={styles.field}><span className="t-small muted">PayPal.Me</span><input name="paypal" className={`${styles.input} code`} placeholder="jmeno" /></label>
            <label className={styles.field}><span className="t-small muted">Revolut (revtag)</span><input name="revtag" className={`${styles.input} code`} placeholder="@jmeno" /></label>
            <span className="t-small muted">Údaje uvidí jen tento prodejce a jen do uzavření hlášení.</span>
          </Step>
        ) : <p className="t-small muted">Kupující vyplní, kam mu peníze poslat.</p>
      ) : null}
      {r.payout_at && !r.comp_sent_at && (!ret || r.return_received_at) ? (
        seller ? (
          <div className={styles.rows}>
            <span className="t-label muted">POSLAT KUPUJÍCÍMU</span>
            {r.payout_bank ? (
              <div className={styles.quote}>
                {qr ? <div dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label="QR platba" style={{ width: 132, background: '#fff', padding: 8, borderRadius: 6, marginBottom: 8 }} /> : null}
                <div className={styles.row}><span>Účet</span><span className="code">{czAccountNumber(r.payout_bank) ?? formatIban(r.payout_bank)}</span></div>
              </div>
            ) : null}
            {r.payout_paypal ? <div className={styles.row}><span>PayPal</span><a className="code" href={`https://paypal.me/${r.payout_paypal}/${pay}CZK`} target="_blank" rel="noopener noreferrer">paypal.me/{r.payout_paypal}</a></div> : null}
            {r.payout_revtag ? <div className={styles.row}><span>Revolut</span><a className="code" href={`https://revolut.me/${r.payout_revtag}?currency=CZK&amount=${pay * 100}`} target="_blank" rel="noopener noreferrer">@{r.payout_revtag}</a></div> : null}
            <div className={styles.row}><span>Částka</span><Price amount={pay} /></div>
            <Step id={r.id} op="comp_sent" label="Odesláno">
              <label className={styles.field}>
                <span className="t-small muted">Jak jste poslali</span>
                <select name="via" className={styles.input} defaultValue={r.payout_bank ? 'bank' : r.payout_paypal ? 'paypal' : 'revolut'}>
                  {r.payout_bank ? <option value="bank">Převodem</option> : null}
                  {r.payout_paypal ? <option value="paypal">PayPal</option> : null}
                  {r.payout_revtag ? <option value="revolut">Revolut</option> : null}
                </select>
              </label>
            </Step>
            <span className="t-small muted">Platíte přímo kupujícímu, V4cards peníze nepřijímá.</span>
          </div>
        ) : <p className="t-small muted">Prodejce pošle {formatPrice(pay)} na údaje, které jste vyplnili.</p>
      ) : null}
      {r.comp_sent_at ? (
        buyer ? (
          <div className={styles.rows}>
            <p className="t-small">Prodejce poslal {formatPrice(pay)} {r.comp_sent_via ? VIA_NAME[r.comp_sent_via] : ''} {formatDateTime(r.comp_sent_at)}. Převod může trvat až 2 pracovní dny.</p>
            <div className={styles.two}>
              <Step id={r.id} op="comp_ok" label="Peníze přišly" className={styles.full} />
              <Step id={r.id} op="comp_missing" label="Nepřišly" variant="secondary" className={styles.full} />
            </div>
          </div>
        ) : <p className="t-small muted">Kupující potvrdí, že peníze přišly.</p>
      ) : null}
      <ButtonLink href={`/zpravy/${buyer ? o.seller_id : o.buyer_id}`} variant="ghost">Napsat {buyer ? 'prodejci' : 'kupujícímu'}</ButtonLink>
    </div>
  );
}
