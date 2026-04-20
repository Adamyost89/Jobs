/**
 * Logical columns for tabular commission payout import (maps to 0-based sheet column indices).
 */

export const PAYOUT_COLUMN_KEYS = [
  "payPeriodLabel",
  "salespersonName",
  "salespersonId",
  "jobNumber",
  "amount",
  "notes",
  "importSourceKey",
] as const;

export type PayoutColumnKey = (typeof PAYOUT_COLUMN_KEYS)[number];

export type PayoutColumnMap = Partial<Record<PayoutColumnKey, number>>;

function normCell(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/^\ufeff/, "")
    .toLowerCase();
}

/** Score a row as a header row (higher = more likely). */
function headerRowScore(row: unknown[]): number {
  if (!row?.length) return 0;
  let score = 0;
  for (const c of row) {
    const h = normCell(c);
    if (!h) continue;
    if (h.includes("pay") && h.includes("period")) score += 4;
    if (h === "amount" || (h.includes("amount") && !h.includes("job"))) score += 2;
    if (h.includes("payout") || h.includes("paid") || h.includes("payment")) score += 2;
    if (h.includes("job") && (h.includes("#") || h.includes("number"))) score += 2;
    if (h.includes("sales") || h.includes("rep") || h === "am" || h.includes("account manager")) score += 2;
    if (h.includes("note")) score += 1;
    if (h.includes("import") || h.includes("source") || h.includes("idempot")) score += 1;
  }
  return score;
}

export function findPayoutHeaderRowIndex(rows: unknown[][]): number {
  let best = 0;
  let bestScore = headerRowScore(rows[0] ?? []);
  const maxScan = Math.min(rows.length, 25);
  for (let r = 1; r < maxScan; r++) {
    const s = headerRowScore(rows[r] ?? []);
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  if (bestScore < 2) return 0;
  return best;
}

/**
 * Guess 0-based column indices from a header row (first matching column wins per logical field).
 */
export function suggestPayoutColumnMapFromHeader(headerRow: unknown[]): PayoutColumnMap {
  const map: PayoutColumnMap = {};
  const taken = new Set<number>();

  const tryAssign = (key: PayoutColumnKey, colIndex: number) => {
    if (map[key] !== undefined || taken.has(colIndex)) return;
    map[key] = colIndex;
    taken.add(colIndex);
  };

  const arr = headerRow ?? [];
  for (let i = 0; i < arr.length; i++) {
    const h = normCell(arr[i]);
    if (!h) continue;

    if (
      h.includes("pay") &&
      (h.includes("period") || h.includes("month") || h.includes("window") || h.includes("cycle"))
    )
      tryAssign("payPeriodLabel", i);
    else if (h.includes("import") || h.includes("idempot") || (h.includes("source") && h.includes("key")))
      tryAssign("importSourceKey", i);
    else if (h.includes("job") && (h.includes("#") || h.includes("number") || h.includes("no")))
      tryAssign("jobNumber", i);
    else if (
      h === "paid" ||
      (h.includes("paid") &&
        !h.includes("date") &&
        !h.includes("full") &&
        !h.includes("order") &&
        !h.includes("period"))
    )
      tryAssign("amount", i);
    else if (
      h === "sp id" ||
      h === "salespersonid" ||
      h === "salesperson id" ||
      (h.includes("salesperson") && h.includes("id"))
    )
      tryAssign("salespersonId", i);
    else if (
      h.includes("salesperson") ||
      h.includes("sales rep") ||
      (h.includes("rep") && !h.includes("job")) ||
      h === "am" ||
      (h.includes("account") && h.includes("manager"))
    )
      tryAssign("salespersonName", i);
    else if (h.includes("note") || h.includes("memo") || h.includes("comment")) tryAssign("notes", i);
    else if (h.includes("amount") || h.includes("payout") || h.includes("payment") || h === "$")
      tryAssign("amount", i);
  }

  return map;
}

export function mergePayoutColumnMap(base: PayoutColumnMap, overrides: PayoutColumnMap): PayoutColumnMap {
  const out: PayoutColumnMap = { ...base };
  for (const k of PAYOUT_COLUMN_KEYS) {
    const v = overrides[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
      out[k] = v;
    }
  }
  return out;
}

export function payoutColumnMapKeySet(): Set<string> {
  return new Set(PAYOUT_COLUMN_KEYS as unknown as string[]);
}
