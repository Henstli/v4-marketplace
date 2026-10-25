import { Skeleton } from '@/components/trezor';
import styles from './detail.module.css';

// Detail karty během načítání: stejné rozvržení jako stránka, ať se po načtení nic neposune.
export default function CardDetailLoading() {
  return (
    <div className="container tz-loading" role="status" aria-label="Načítání">
      <div className={styles.crumbs}>
        <Skeleton width={220} height={14} />
      </div>
      <div className={styles.top}>
        <Skeleton className={styles.art} radius="var(--radius-xl)" />
        <div className={styles.info}>
          <Skeleton width={80} height={12} />
          <Skeleton width="70%" height={40} />
          <Skeleton text width="50%" />
          <div className={`panel ${styles.buy}`}>
            <Skeleton width={160} height={30} />
            <Skeleton width={260} height={52} radius="var(--radius-lg)" />
          </div>
        </div>
      </div>
    </div>
  );
}
