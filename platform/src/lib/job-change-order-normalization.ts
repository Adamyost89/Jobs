import { Prisma, type PrismaClient } from "@prisma/client";
import { deriveChangeOrdersNumber, MONEY_EPSILON } from "@/lib/change-orders";

export async function reconcileChangeOrdersFromPaidAndContract(
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

  const toUpdate = rows
    .map((row) => {
      const paid = row.amountPaid?.toNumber();
      if (paid == null) return null;
      const contract = row.contractAmount.toNumber();
      const changeOrders = row.changeOrders.toNumber();
      const derived = deriveChangeOrdersNumber(contract, paid);
      if (derived === null) return null;
      if (Math.abs(changeOrders - derived) <= MONEY_EPSILON) return null;
      return { id: row.id, derived };
    })
    .filter((row): row is { id: string; derived: number } => row !== null);

  if (toUpdate.length === 0) {
    return { scanned: rows.length, matched: 0, updated: 0 };
  }

  let updated = 0;
  for (const row of toUpdate) {
    await db.job.update({
      where: { id: row.id },
      data: { changeOrders: new Prisma.Decimal(row.derived.toFixed(2)) },
    });
    updated += 1;
  }

  return {
    scanned: rows.length,
    matched: toUpdate.length,
    updated,
  };
}

export async function normalizeChangeOrdersWhenPaidMatchesContract(
  db: Pick<PrismaClient, "job">
): Promise<{ scanned: number; matched: number; updated: number }> {
  return reconcileChangeOrdersFromPaidAndContract(db);
}
