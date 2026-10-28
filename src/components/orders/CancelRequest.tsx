import { formatDateTime } from '@/lib/format';
import styles from './ShipChange.module.css';

/**
 * Žádost prodejce o zrušení zaplacené objednávky (DS Reports › Žádost o zrušení):
 * kupující vidí, kdo žádá, proč a co znamená Souhlasím a Nesouhlasím; prodejce, že čeká.
 * Po Nesouhlasím se žádost nedá poslat znovu, prodejce může zrušit až po čekací době.
 */
export function CancelRequestBlock({ role, requestedAt, rejectedAt }: {
  role: 'buyer' | 'seller';
  requestedAt: string | null;
  rejectedAt: string | null;
}) {
  if (requestedAt) {
    return role === 'buyer' ? (
      <div className={styles.block}>
        <strong className={styles.title}>Prodejce žádá o zrušení objednávky</strong>
        <span>Prodejce píše, že vaši platbu nenašel, a chce objednávku zrušit ({formatDateTime(requestedAt)}).</span>
        <ul className={styles.note} style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
          <li><strong>Souhlasím</strong>, když jste opravdu nezaplatili nebo už nechcete kupovat. Objednávka se zruší a prodejci se nezapočítá.</li>
          <li><strong>Nesouhlasím</strong>, když jste zaplatili. Prodejce už o zrušení znovu žádat nemůže, platbu musí hledat dál. Doporučujeme nahlásit problém a přiložit potvrzení platby.</li>
        </ul>
      </div>
    ) : (
      <div className={styles.block}>
        <strong className={styles.title}>Čekáte na odpověď kupujícího</strong>
        <span className={styles.note}>Požádali jste o zrušení {formatDateTime(requestedAt)}. Když kupující nesouhlasí, o zrušení už znovu žádat nejde a Zrušit půjde až po čekací době.</span>
      </div>
    );
  }
  if (rejectedAt) {
    return (
      <div className={styles.block}>
        <strong className={styles.title}>{role === 'buyer' ? 'Se zrušením jste nesouhlasili' : 'Kupující se zrušením nesouhlasil'}</strong>
        <span className={styles.note}>
          {role === 'buyer'
            ? `${formatDateTime(rejectedAt)}. Pokud platbu prodejce nenajde, může objednávku po čekací době zrušit. Pak ho můžete ohodnotit a nahlásit problém.`
            : `${formatDateTime(rejectedAt)}. Kupující trvá na tom, že zaplatil. Hledejte platbu dál; zrušit půjde po čekací době a kupující vás pak může ohodnotit.`}
        </span>
      </div>
    );
  }
  return null;
}
