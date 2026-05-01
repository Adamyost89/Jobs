import { Prisma } from "@prisma/client";

export const MONEY_EPSILON = 0.005;

function dec(n: Prisma.Decimal | number | string): number {
  if (n instanceof Prisma.Decimal) return n.toNumber();
  return Number(n) || 0;
}

export function moneyEq(a: number | null | undefined, b: number | null | undefined, epsilon = MONEY_EPSILON): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Math.abs(a - b) <= epsilon;
}

export function deriveChangeOrdersNumber(
  contractAmount: Prisma.Decimal | number | string,
  amountPaid: Prisma.Decimal | number | string | null | undefined
): number | null {
  if (amountPaid === null || amountPaid === undefined) return null;
  return dec(amountPaid) - dec(contractAmount);
}

