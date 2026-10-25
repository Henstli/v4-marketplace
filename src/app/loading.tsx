import { Skeleton, SkeletonTile } from '@/components/trezor';

// Výchozí stav načítání pro stránky bez vlastního (úvodní stránka, účet, prodej, objednávky).
export default function Loading() {
  return (
    <div className="container section" role="status" aria-label="Načítání">
      <div className="section-head">
        <Skeleton width={280} height={32} />
      </div>
      <div className="card-grid">
        {Array.from({ length: 8 }, (_, i) => <SkeletonTile key={i} />)}
      </div>
    </div>
  );
}
