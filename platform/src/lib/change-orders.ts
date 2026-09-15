export const MONEY_EPSILON = 0.005;

type DecLike = number | string | { toNumber: () => number };

function dec(n: DecLike): number {
  if (typeof n === "object" && n && typeof n.toNumber === "function") return n.toNumber();
  return Number(n) || 0;
}

function decOrNull(n: DecLike | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  return dec(n);
}

function roundMoney(n: number): number {
  return Number(n.toFixed(2));
}

function normalizeStatusText(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function statusLooksPaid(raw: string | null | undefined): boolean {
  const text = normalizeStatusText(raw);
  if (!text) return false;
  if (text === "PAID" || text === "INVOICE PAID") return true;
  if (text === "PAID & CLOSED" || text === "PAID AND CLOSED") return true;
  return false;
}

/** Negative invoice-vs-contract COs stay at $0 until the job is paid / paid & closed. */
export function allowsNegativeChangeOrders(
  status: string | null | undefined,
  prolineStage?: string | null,
  paidInFull?: boolean | null
): boolean {
  if (paidInFull === true) return true;
  return statusLooksPaid(status) || statusLooksPaid(prolineStage);
}

export function moneyEq(a: number | null | undefined, b: number | null | undefined, epsilon = MONEY_EPSILON): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Math.abs(a - b) <= epsilon;
}

export type ChangeOrderSource = {
  contractAmount: DecLike;
  invoicedTotal?: DecLike | null;
  status?: string | null;
  prolineStage?: string | null;
  paidInFull?: boolean | null;
};

/**
 * Change orders follow invoiced − contract whenever invoiced is set.
 * Positive differences always apply (status and costing are ignored).
 * Negative differences stay 0 until paid / paid & closed.
 */
export function resolvedChangeOrders(job: ChangeOrderSource): number {
  const contract = dec(job.contractAmount);
  const invoiced = decOrNull(job.invoicedTotal);
  if (invoiced === null || Math.abs(invoiced) <= MONEY_EPSILON) return 0;
  const delta = invoiced - contract;
  if (Math.abs(delta) <= MONEY_EPSILON) return 0;
  if (delta > 0) return roundMoney(delta);
  if (allowsNegativeChangeOrders(job.status, job.prolineStage, job.paidInFull)) {
    return roundMoney(delta);
  }
  return 0;
}

/** @deprecated Use resolvedChangeOrders. Kept for call sites that still pass paid as a fallback. */
export function deriveChangeOrdersNumber(
  contractAmount: DecLike,
  invoicedTotal: DecLike | null | undefined,
  _amountPaid?: DecLike | null,
  status?: string | null,
  prolineStage?: string | null,
  paidInFull?: boolean | null
): number | null {
  const invoiced = decOrNull(invoicedTotal);
  if (invoiced === null || Math.abs(invoiced) <= MONEY_EPSILON) return null;
  return resolvedChangeOrders({
    contractAmount,
    invoicedTotal,
    status,
    prolineStage,
    paidInFull,
  });
}

/** True when invoiced is present so CO should be derived (positives always; negatives only if paid). */
export function shouldAutoDeriveChangeOrders(
  _status: string | null | undefined,
  _prolineStage?: string | null,
  invoicedTotal?: DecLike | null
): boolean {
  const invoiced = decOrNull(invoicedTotal ?? null);
  return invoiced !== null && Math.abs(invoiced) > MONEY_EPSILON;
}
