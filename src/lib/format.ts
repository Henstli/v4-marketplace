// Český formát čísel: nezlomitelná mezera mezi tisíci, desetinná čárka (README design systému).
export function formatNumber(n: number, decimals = 0): string {
  const parts = Math.abs(n).toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (n < 0 ? '−' : '') + parts.join(',');
}

export function formatPrice(amount: number, currency = 'Kč'): string {
  return `${formatNumber(amount)} ${currency}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
