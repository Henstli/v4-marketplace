import { cx } from './cx';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Zaoblení, výchozí radius-sm */
  radius?: string;
  /** Řádek textu (výška 14 px, plná šířka) */
  text?: boolean;
  className?: string;
}

// Zástupný blok, dokud se obsah načítá. Rozměry odpovídají obsahu, který nahradí.
export function Skeleton({ width, height, radius, text, className }: SkeletonProps) {
  return (
    <span
      className={cx('tz-skel', text && 'tz-skel-text', className)}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

// Dlaždice karty během načítání: stejné rozměry jako CardTile, ať se mřížka po načtení nepohne.
export function SkeletonTile() {
  return (
    <div className="tz-tile tz-tile-skel" aria-hidden="true">
      <div className="tz-tile-art">
        <Skeleton width="100%" height="100%" radius="var(--radius-md)" />
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <Skeleton text width="80%" height={16} />
        <Skeleton text width="55%" height={13} />
      </div>
      <div className="tz-tile-row">
        <Skeleton width={72} height={20} />
        <Skeleton width={52} height={16} />
      </div>
    </div>
  );
}
