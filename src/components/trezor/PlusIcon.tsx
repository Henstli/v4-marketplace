/** Ikona plus (varianta A): tučný tah se zaoblenými konci, vždy přesně na středu. */
export function PlusIcon({ size = 16, stroke = 2.75 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
