import { Skeleton, SkeletonTile } from '@/components/trezor';
import styles from './home.module.css';

// Úvodní stránka během načítání: úvodní text se statistikami, panel s trendem a mřížka karet.
export default function HomeLoading() {
  return (
    <div className="tz-loading" role="status" aria-label="Načítání">
      <section className={`container ${styles.hero}`}>
        <div className={styles.heroText}>
          <Skeleton width={200} height={12} />
          <Skeleton width="85%" height={48} />
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton text width="95%" />
            <Skeleton text width="80%" />
          </div>
          <div className={styles.heroActions}>
            <Skeleton width={180} height={52} radius="var(--radius-lg)" />
            <Skeleton width={170} height={52} radius="var(--radius-lg)" />
          </div>
          <div className={styles.stats}>
            {[0, 1, 2].map((i) => <Skeleton key={i} width={110} height={44} />)}
          </div>
        </div>
        <div className={`panel ${styles.heroPanel}`}>
          <Skeleton width={180} height={12} />
          <Skeleton width="60%" height={28} />
          <Skeleton text width="45%" />
          <Skeleton height={120} />
        </div>
      </section>
      <section className="container section">
        <div className="section-head">
          <Skeleton width={280} height={28} />
        </div>
        <div className="card-grid">
          {Array.from({ length: 8 }, (_, i) => <SkeletonTile key={i} />)}
        </div>
      </section>
    </div>
  );
}
