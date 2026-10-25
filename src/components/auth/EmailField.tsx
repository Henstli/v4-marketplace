import styles from './auth.module.css';

export function EmailField({ defaultValue }: { defaultValue?: string }) {
  return (
    <label className={styles.field}>
      <span className="t-label muted">E-MAIL</span>
      <input type="email" name="email" required autoComplete="email" placeholder="vas@email.cz" defaultValue={defaultValue} className={styles.input} />
    </label>
  );
}
