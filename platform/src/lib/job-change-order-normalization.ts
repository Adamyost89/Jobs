import { Prisma, type PrismaClient } from "@prisma/client";

const MONEY_EPSILON = 0.005;

export async function normalizeChangeOrdersWhenPaidMatchesContract(
  db: Pick<PrismaClient, "job">
): Promise<{ scanned: number; matched: number; updated: number }> {
  const rows = await db.job.findMany({
    where: {
      amountPaid: { not: null },
      NOT: { changeOrders: { equals: 0 } },
    },
    select: {
      id: true,
      contractAmount: true,
      amountPaid: true,
      changeOrders: true,
    },
    take: 20_000,
  });

  const matchingIds = rows
    .filter((row) => {
      const paid = row.amountPaid?.toNumber();
      if (paid == null) return false;
      const contract = row.contractAmount.toNumber();
      const changeOrders = row.changeOrders.toNumber();
      return Math.abs(paid - contract) <= MONEY_EPSILON && Math.abs(changeOrders) > MONEY_EPSILON;
    })
    .map((row) => row.id);

  if (matchingIds.length === 0) {
    return { scanned: rows.length, matched: 0, updated: 0 };
  }

  const res = await db.job.updateMany({
    where: { id: { in: matchingIds } },
    data: { changeOrders: new Prisma.Decimal("0") },
  });

  return {
    scanned: rows.length,
    matched: matchingIds.length,
    updated: res.count,
  };
}
