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

