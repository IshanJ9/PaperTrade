const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// Display only: money arithmetic happens on the server; the app just formats the strings it receives.
export function formatMoney(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? usd.format(n) : value;
}

export function pnlColor(value: string): string {
  const n = Number(value);
  if (n > 0) return '#16a34a';
  if (n < 0) return '#dc2626';
  return '#6b7280';
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}
