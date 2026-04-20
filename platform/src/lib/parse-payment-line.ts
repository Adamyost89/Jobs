/** Same format as Google Apps Script Total Commissions cells: `jobNumber - customer - $amount` per line. */
export function parsePaymentLine(line: string): { jobNumber: string; customer: string; amount: number } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/\$([0-9,]+\.?\d*)\s*$/);
  if (!m) return null;
  const before = trimmed.slice(0, trimmed.length - m[0].length).trim();
  const idx = before.indexOf(" - ");
  if (idx === -1) return null;
  const jobNumber = before.slice(0, idx).trim();
  const customer = before.slice(idx + 3).trim();
  const amount = parseFloat(m[1]!.replace(/,/g, ""));
  if (!jobNumber || Number.isNaN(amount)) return null;
  return { jobNumber, customer, amount };
}
