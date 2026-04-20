/** Round currency to cents for display / comparisons. */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Align "Paid" / "Owed" with posted checks: Excel `import:payouts` writes `CommissionPayout` rows but does not
 * bump `Commission.paidAmount`, so the ledger can show $0 paid while history lists checks.
 *
 * Uses implicit total `ledgerPaid + ledgerOwed` from the commission row, then applies posted check totals.
 */
export function commissionDisplayAmounts(
  ledgerPaid: number,
  ledgerOwed: number,
  payoutSum: number,
  salespersonActive: boolean
): { displayPaid: number; displayOwed: number } {
  const lp = roundMoney(ledgerPaid);
  const lo = roundMoney(ledgerOwed);
  const ps = roundMoney(payoutSum);
  const displayPaid = roundMoney(Math.max(lp, ps));
  const displayOwed = salespersonActive ? Math.max(0, roundMoney(lp + lo - displayPaid)) : 0;
  return { displayPaid, displayOwed };
}
