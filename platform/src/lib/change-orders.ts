import { Prisma } from "@prisma/client";

export const MONEY_EPSILON = 0.005;

function dec(n: Prisma.Decimal | number | string): number {
  if (n instanceof Prisma.Decimal) return n.toNumber();
  return Number(n) || 0;
}

function decOrNull(n: Prisma.Decimal | number | string | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  return dec(n);
}

function normalizeStatusText(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

export function shouldAutoDeriveChangeOrders(
  status: string | null | undefined,
  prolineStage?: string | null
): boolean {
  const statusText = normalizeStatusText(status);
  const stageText = normalizeStatusText(prolineStage);
  const isPaidClosed =
    statusText === "PAID & CLOSED" ||
    statusText === "PAID AND CLOSED" ||
    stageText === "PAID & CLOSED" ||
    stageText === "PAID AND CLOSED";
  const isInvoicePaid = statusText === "INVOICE PAID" || stageText === "INVOICE PAID";
  return isPaidClosed || isInvoicePaid;
}

export function moneyEq(a: number | null | undefined, b: number | null | undefined, epsilon = MONEY_EPSILON): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Math.abs(a - b) <= epsilon;
}

export function deriveChangeOrdersNumber(
  contractAmount: Prisma.Decimal | number | string,
  invoicedTotal: Prisma.Decimal | number | string | null | undefined,
  amountPaid: Prisma.Decimal | number | string | null | undefined
): number | null {
  const contract = dec(contractAmount);
  const invoiced = decOrNull(invoicedTotal);
  if (invoiced !== null && Math.abs(invoiced) > MONEY_EPSILON) {
    return invoiced - contract;
  }
  const paid = decOrNull(amountPaid);
  if (paid !== null) {
    return paid - contract;
  }
  return null;
}

