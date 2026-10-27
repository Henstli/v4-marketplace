import styles from './ShipChange.module.css';

const kc = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`;

/**
 * Čekající vyšší doprava (DS DeliveryPayment › blok změny, varianta A): stará a nová doprava,
 * starý a nový součet a důvod od prodejce. Stejný v chatu i v detailu objednávky.
 */
export function ShipChangeBlock({ shipping, change, total, reason, role, requested, transfer }: {
  shipping: number;
  change: number;
  /** Současný součet se starou dopravou */
  total: number;
  reason: string | null;
  role: 'buyer' | 'seller';
  requested: boolean;
  transfer: boolean;
}) {
  const next = total - shipping + change;
  const buyer = role === 'buyer';
  return (
    <div className={styles.block}>
      <strong className={styles.title}>{buyer ? 'Prodejce zvýšil cenu dopravy' : 'Navrhli jste vyšší dopravu'}</strong>
      <dl className={styles.rows}>
        <div>
          <dt>Doprava</dt>
          <dd><s>{kc(shipping)}</s> <span aria-hidden="true">→</span> <strong>{kc(change)}</strong> <span className={styles.diff}>+{change - shipping}</span></dd>
        </div>
        <div>
          <dt>Celkem</dt>
          <dd><s>{kc(total)}</s> <span aria-hidden="true">→</span> <strong>{kc(next)}</strong></dd>
        </div>
      </dl>
      {reason ? (
        <blockquote className={styles.reason}>
          <span className="t-label muted">DŮVOD OD PRODEJCE</span>
          <span>{reason}</span>
        </blockquote>
      ) : null}
      <span className={styles.note}>
        {buyer
          ? `${transfer ? 'QR pro platbu uvidíte, až změnu odsouhlasíte.' : 'Při převzetí zaplatíte novou částku.'} Když nesouhlasíte, objednávka se zruší bez následků.`
          : requested ? 'Platí od potvrzení objednávky. Kupující ji musí odsouhlasit, než uvidí QR kód.' : 'Kupující ji musí odsouhlasit, do té doby nevidí QR kód.'}
      </span>
    </div>
  );
}
