export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Bez zadání se určí z první a poslední hodnoty */
  tone?: 'up' | 'down';
  /** Plocha pod čarou */
  area?: boolean;
  strokeWidth?: number;
  /** Popis pro čtečky; bez něj je graf dekorativní */
  label?: string;
}

export function Sparkline({ values, width = 88, height = 28, tone, area, strokeWidth = 2, label }: SparklineProps) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 6)]);
  const up = tone ? tone === 'up' : values[values.length - 1] >= values[0];
  const stroke = up ? 'var(--up)' : 'var(--down)';
  const line = pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  return (
    <svg
      className="tz-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      {area ? <path d={`M0,${height} L${line.split(' ').join(' L')} L${width},${height} Z`} fill={stroke} fillOpacity={0.08} /> : null}
      <polyline points={line} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
  );
}
