import { Skeleton, SkeletonTile } from '@/components/trezor';
import styles from './seller.module.css';

// Ukáže se hned po kliknutí na prodejce, než server pošle jeho nabídky.
export default function SellerLoading() {
  return (
    <div className={`container ${styles.page} tz-loading`} role="status" aria-label="Načítání">
      <section className={`panel ${styles.head}`} aria-hidden="true">
        <Skeleton width={72} height={12} />
        <Skeleton width={260} height={28} />
        <Skeleton text width="50%" />
      </section>
      <div className="card-grid">
        {Array.from({ length: 8 }, (_, i) => <SkeletonTile key={i} />)}
      </div>
    </div>
  );
}
