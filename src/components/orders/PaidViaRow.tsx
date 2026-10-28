import { Price } from '@/components/trezor';
import { formatDateTime } from '@/lib/format';
import { PAID_VIA, type PaidVia } from '@/lib/order-flow';
import styles from './prepay.module.css';

// Kde prodejce platbu zkontroluje; u převodu ve vlastní bance, odkaz nemáme.
const CHECK_URL: Partial<Record<PaidVia, string>> = {
  paypal: 'https://www.paypal.com/myaccount/activities',
  revolut: 'https://app.revolut.com/',
};

/**
 * Řádek PLATBA (DS OrderPayment › Jak jste zaplatili, varianta B): jak kupující zaplatil a kdy.
 * Dokud prodejce platbu nepotvrdí, má oranžový obrys a prodejce odkaz ke kontrole.
 */
export function PaidViaRow({ via, at, amount, role, pending, compact = false }: {
  via: PaidVia;
  at: string;
  amount: number;
  role: 'buyer' | 'seller';
  /** Prodejce ještě nepotvrdil, že platba přišla. */
  pending: boolean;
  /** Úzká verze do bubliny v chatu. */
  compact?: boolean;
}) {
  const name = PAID_VIA[via].name;
  const check = role === 'seller' && pending ? CHECK_URL[via] : undefined;
  return (
    <div className={`${styles.via} ${pending ? styles.viaPending : ''} ${compact ? styles.viaCompact : ''}`}>
      <div className={styles.viaText}>
        <span className="t-label muted">PLATBA</span>
        {compact ? (
          <span><strong>{name}</strong> · {formatDateTime(at)}</span>
        ) : (
          <>
            <span><strong>{name}</strong></span>
            <span className={pending ? styles.viaWhen : 't-small muted'}>
              {role === 'seller' ? 'Kupující zaplatil' : 'Zaplatili jste'} {formatDateTime(at)} · <Price amount={amount} />
            </span>
          </>
        )}
      </div>
      {check ? (
        <a href={check} target="_blank" rel="noopener noreferrer" className={compact ? styles.viaLink : styles.viaBtn}>
          {compact ? 'Otevřít' : `Otevřít ${name}`}
        </a>
      ) : null}
    </div>
  );
}
