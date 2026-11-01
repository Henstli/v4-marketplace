// Iniciály druhé strany v objednávkách (DS Orders › tz-ord-ava). Barva podle id, aby byla u člověka vždy stejná.
const COLORS = ['#3b6fd4', '#4fa3d4', '#8a5cf0', '#d4568a', '#e08a3c', '#3ca39a', '#5c8a3c', '#b85cd4'];

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s._-]/gu, '').split(/[\s._-]+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}

function color(id: string | null | undefined): string {
  let h = 0;
  for (const c of id ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Ava({ id, name, size }: { id: string | null | undefined; name: string; size?: 'l' }) {
  return (
    <span className="tz-ord-ava" data-size={size} style={{ background: color(id) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
