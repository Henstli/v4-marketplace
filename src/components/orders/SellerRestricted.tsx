import styles from './ShipChange.module.css';

/**
 * Varování kupujícího, když prodejce pozastavila podpora a kupující ještě neklikl Zaplaceno (DS Support, Šimon 28. 10.).
 * Zaplacenou objednávku dokončí v klidu, nezaplacenou smí zrušit.
 */
export function SellerRestrictedNotice() {
  return (
    <div className={styles.block}>
      <strong className={styles.title}>Prodejce teď řeší podpora V4cards</strong>
      <span className={styles.note}>
        Pokud jste už zaplatili, pokračujte v klidu dál a klikněte na Zaplaceno. Pokud jste ještě nezaplatili a chcete
        z objednávky vycouvat, můžete ji zrušit.
      </span>
    </div>
  );
}
