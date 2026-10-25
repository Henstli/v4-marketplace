import { Skeleton } from '@/components/trezor';

// Neutrální stav načítání pro stránky bez vlastního (úvodní stránka, účet, prodej, objednávky):
// nadpis a panely s řádky textu, ne kostra katalogu, ať po kliknutí neproblikne cizí rozvržení.
export default function Loading() {
  return (
    <div
      className="container section"
      role="status"
      aria-label="Načítání"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}
    >
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <Skeleton width={240} height={32} />
        <Skeleton text width="45%" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Skeleton width={180} height={22} />
          <Skeleton text width="90%" />
          <Skeleton text width="75%" />
          <Skeleton text width="60%" />
        </div>
      ))}
    </div>
  );
}
