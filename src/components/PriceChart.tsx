import { formatNumber } from '@/lib/format';
import styles from './PriceChart.module.css';

// Velký graf vývoje ceny podle pravidel „Grafy“ v README design systému:
// čára 2,5 px v up/down, plocha 8 %, mřížka v line, průměr přerušovaně v ink-muted, popisky v mono.
// Graf se roztahuje na šířku panelu, popisky jsou HTML, aby měly stálou velikost.
export function PriceChart({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 1000;
  const h = 240;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lo = min - span * 0.1;
  const hi = max + span * 0.1;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
  const pct = (v: number) => `${(y(v) / h) * 100}%`;

  const up = values[values.length - 1] >= values[0];
  const stroke = up ? 'var(--up)' : 'var(--down)';
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L');
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const ticks = [0, 1, 2, 3].map((t) => lo + ((hi - lo) * t) / 3);

  return (
    <figure className={styles.chart} role="img" aria-label={label}>
      <div className={styles.axis} aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ top: pct(t) }}>{formatNumber(Math.round(t))}</span>
        ))}
      </div>
      <div className={styles.plot}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          {ticks.map((t) => (
            <line key={t} x1={0} x2={w} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={`M0,${h} L${line} L${w},${h} Z`} fill={stroke} fillOpacity={0.08} />
          <line x1={0} x2={w} y1={y(avg)} y2={y(avg)} stroke="var(--ink-muted)" strokeWidth={1.5} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
          <path d={`M${line}`} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className={styles.days} aria-hidden="true">
          <span>před 30 dny</span>
          <span>před 15 dny</span>
          <span>dnes</span>
        </div>
      </div>
    </figure>
  );
}
