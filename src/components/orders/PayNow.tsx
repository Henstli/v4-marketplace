'use client';

import { useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/trezor';
import { setOrderStatus } from '@/app/objednavky/actions';
import type { PaidVia } from '@/lib/order-flow';

export interface PayMethod {
  key: PaidVia;
  label: string;
  /** SVG QR kódu (u převodu SPAYD, u PayPalu a Revolutu odkaz), null když nejde. */
  qr: string | null;
  rows: Array<{ k: string; v: string; code?: boolean; copy?: boolean }>;
  link?: { href: string; label: string; hint: string };
  note?: string;
}

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="tz-ord-copy"
      onClick={() => navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {})}
    >
      {done ? 'Zkopírováno' : 'Kopírovat'}
    </button>
  );
}

function Paid({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Ukládám…' : label}</Button>;
}

/**
 * „Zaplaťte“ v rámečku Co teď (DS Orders): záložky podle toho, co prodejce nabízí, u každé QR a údaje.
 * Tlačítko Zaplaceno si vezme vybranou záložku, kupující se už neptáme „Jak jste zaplatili?“.
 */
export function PayNow({ id, title, text, methods, cancel, more }: { id: string; title: string; text: string; methods: PayMethod[]; cancel?: ReactNode; more?: ReactNode }) {
  const [pick, setPick] = useState<PaidVia>(methods[0]?.key ?? 'bank');
  const m = methods.find((x) => x.key === pick) ?? methods[0];
  return (
    <section className="tz-ord-now" aria-labelledby="co-ted">
      <div className="tz-ord-now-top">
        <div className="tz-ord-now-tx">
          <p className="tz-ord-now-lbl">Co teď</p>
          <h2 id="co-ted">{title}</h2>
          <p>{text}</p>
        </div>
        <div className="tz-ord-now-acts">
          {cancel}
          {m ? (
            <form action={setOrderStatus}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="op" value="mark_paid" />
              <input type="hidden" name="via" value={m.key} />
              <Paid label={`Zaplaceno přes ${m.label}`} />
            </form>
          ) : null}
        </div>
      </div>
      <div className="tz-ord-now-more">
        {m ? (
          <div className="tz-ord-pay" data-noqr={m.qr ? undefined : ''}>
            {m.qr ? <div className="tz-ord-qr" role="img" aria-label={`QR kód: ${m.label}`} dangerouslySetInnerHTML={{ __html: m.qr }} /> : null}
            <div>
              {methods.length > 1 ? (
                <div className="tz-ord-ptabs" role="group" aria-label="Způsob platby">
                  {methods.map((x) => <button key={x.key} type="button" aria-pressed={x.key === m.key} onClick={() => setPick(x.key)}>{x.label}</button>)}
                </div>
              ) : null}
              <dl className="tz-ord-kv">
                {m.rows.map((r) => (
                  <div key={r.k} style={{ display: 'contents' }}>
                    <dt>{r.k}</dt>
                    <dd className={r.code ? 'tz-ord-num' : undefined}>{r.v}</dd>
                    <dd>{r.copy ? <Copy value={r.v.replace(/\s/g, ' ')} /> : null}</dd>
                  </div>
                ))}
              </dl>
              {m.link ? (
                <p className="tz-ord-paylink">
                  <a className="tz-btn tz-btn-primary tz-btn-md" href={m.link.href} target="_blank" rel="noopener noreferrer">{m.link.label} ↗</a>
                  {m.qr ? <span>{m.link.hint}</span> : null}
                </p>
              ) : null}
              {m.note ? <p className="tz-ord-paynote">{m.note}</p> : null}
            </div>
          </div>
        ) : (
          <p className="tz-ord-paynote">Prodejce nemá vyplněnou platbu předem. Napište mu ve zprávách, kam zaplatit.</p>
        )}
        {more}
      </div>
    </section>
  );
}
