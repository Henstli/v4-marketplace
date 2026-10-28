import { ButtonLink } from '@/components/trezor';
import { readiness } from '@/lib/delivery';
import type { createClient } from '@/lib/supabase/server';
import styles from '@/app/ucet/delivery.module.css';

type Supabase = Awaited<ReturnType<typeof createClient>>;
export type Readiness = ReturnType<typeof readiness>;

/** Má prodejce vyplněné jméno, platbu a doručení? Stejné pravidlo hlídá i databáze (seller_ready). */
export async function loadReadiness(supabase: Supabase, userId: string): Promise<Readiness> {
  const [{ data: p }, { data: account }, { data: apps }, { data: methods }] = await Promise.all([
    supabase.from('profiles').select('display_name, country, pickup, cash_on_pickup, pay_transfer').eq('id', userId).maybeSingle(),
    supabase.from('seller_payment').select('user_id').eq('user_id', userId).maybeSingle(),
    supabase.from('seller_payment_apps').select('paypal_me, revtag').eq('user_id', userId).maybeSingle(),
    supabase.from('seller_shipping_methods').select('cod').eq('seller_id', userId),
  ]);
  return readiness({
    named: !!p && (p.display_name ?? '').trim().length >= 2 && !!p.country,
    pickup: !!p?.pickup,
    cashOnPickup: !!p?.cash_on_pickup,
    // Platba předem: převod s účtem, PayPal nebo Revolut (seller_prepay).
    transfer: (!!p?.pay_transfer && !!account) || !!apps?.paypal_me || !!apps?.revtag,
    methods: methods ?? [],
  });
}

/** Výzva před vystavením (DS DeliveryPayment): co chybí a odkaz do nastavení. */
export function SellGate({ r, back }: { r: Readiness; back: 'prodat' | 'import' }) {
  const done = [r.named, r.payment, r.delivery].filter(Boolean).length;
  return (
    <section className={styles.gate} aria-labelledby="gate-title">
      <div className={styles.gateMain}>
        <div>
          <h2 id="gate-title" className={styles.gateTitle}>Než vystavíte první kartu</h2>
          <p className="muted">Kupující musí vědět, jak vám zaplatí a jak kartu dostane. Stačí to vyplnit jednou.</p>
        </div>
        <ul className={styles.todo}>
          <li data-done={r.named ? '' : undefined}><span>Jméno a země prodejce</span></li>
          <li data-done={r.payment ? '' : undefined}><span>Aspoň jeden způsob platby<small>Bankovní účet, hotově při předání nebo dobírka.</small></span></li>
          <li data-done={r.delivery ? '' : undefined}><span>Aspoň jeden způsob doručení<small>Dopravce s cenou nebo osobní předání.</small></span></li>
        </ul>
        <div className={styles.gateActions}>
          <ButtonLink href={`/ucet/nastaveni?zpet=${back}#doprava-platba`}>Doplnit dopravu a platbu</ButtonLink>
          <span className="t-small muted">Zabere asi 2 minuty. Pak se vrátíte sem.</span>
        </div>
      </div>
      <div className={styles.gateSide}>
        <span className="t-label muted">HOTOVO {done} ZE 3</span>
        <span className={styles.gateBar} style={{ ['--done' as string]: `${Math.round((done / 3) * 100)}%` }} />
        <span className="t-small muted">Formulář níže půjde použít, až budou hotové všechny tři body.</span>
      </div>
    </section>
  );
}
