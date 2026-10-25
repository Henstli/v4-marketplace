import { Skeleton, SkeletonTile } from '@/components/trezor';
import styles from './catalog.module.css';

// Ukáže se hned po kliknutí na filtr nebo stránku katalogu, než server pošle výsledky.
export default function CatalogLoading() {
  return (
    <div className={`container ${styles.layout}`} role="status" aria-label="Načítání">
      <aside className={styles.filters} aria-hidden="true">
        <Skeleton height={44} radius="var(--radius-md)" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.group}>
            <Skeleton width={64} height={12} />
            <Skeleton height={36} radius="var(--radius-md)" />
          </div>
        ))}
      </aside>
      <section>
        <div className="section-head">
          <Skeleton width={240} height={28} />
        </div>
        <div className="card-grid">
          {Array.from({ length: 12 }, (_, i) => <SkeletonTile key={i} />)}
        </div>
      </section>
    </div>
  );
}
