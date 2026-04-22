const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return USD_FORMATTER.format(n);
}
