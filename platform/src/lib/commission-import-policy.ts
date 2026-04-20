function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Commission imports (`Commission Data`, person-year sheets, Job Numbering person tabs)
 * are keyed off **Job.year** (not the sheet name).
 *
 * - **2024** — Assume fully paid: workbook may still show residual owed; store
 *   `paid = paid + owed`, `owed = 0`.
 * - **2025 and 2026** — Store **exact** paid and owed from the spreadsheet.
 */
export function normalizeImportedCommissionAmounts(
  jobYear: number,
  paidRaw: number,
  owedRaw: number
): { paid: number; owed: number } {
  const paid = roundMoney(paidRaw);
  const owed = roundMoney(owedRaw);
  if (jobYear === 2024) {
    return { paid: roundMoney(paid + owed), owed: 0 };
  }
  return { paid, owed };
}

/**
 * Before cutover, sheet imports remain source-of-truth for paid/owed in 2024-2026.
 * After cutover, app-side changes (paid toggles, costs, edits) should recalc commissions.
 */
export function skipAutoCommissionRecalcForJobYear(
  jobYear: number,
  cutoverComplete = false
): boolean {
  if (cutoverComplete) return false;
  return jobYear === 2024 || jobYear === 2025 || jobYear === 2026;
}
