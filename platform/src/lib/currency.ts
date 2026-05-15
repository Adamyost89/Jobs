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

/** Parse user-typed money (allows `$`, commas, spaces). Returns null if not a finite number. */
export function parseMoneyInputString(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
