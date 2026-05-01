import { Prisma, type PrismaClient } from "@prisma/client";
import { deriveChangeOrdersNumber, MONEY_EPSILON, shouldAutoDeriveChangeOrders } from "@/lib/change-orders";

export async function reconcileChangeOrdersFromPaidAndContract(
  db: Pick<PrismaClient, "job">
): Promise<{ scanned: number; matched: number; updated: number }> {
  const rows = await db.job.findMany({
    where: {
      OR: [{ amountPaid: { not: null } }, { invoicedTotal: { not: 0 } }],
      NOT: { changeOrders: { equals: 0 } },
    },
    select: {
      id: true,
      contractAmount: true,
      invoicedTotal: true,
      amountPaid: true,
      changeOrders: true,
      status: true,
      prolineStage: true,
    },
    take: 20_000,
  });

  const toUpdate = rows
    .map((row) => {
      const contract = row.contractAmount.toNumber();
      const changeOrders = row.changeOrders.toNumber();
      if (!shouldAutoDeriveChangeOrders(row.status, row.prolineStage)) {
        if (Math.abs(changeOrders) <= MONEY_EPSILON) return null;
        return { id: row.id, derived: 0 };
      }
      const paid = row.amountPaid?.toNumber();
      const invoiced = row.invoicedTotal.toNumber();
      const derived = deriveChangeOrdersNumber(contract, invoiced, paid);
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
    const result = await db.job.updateMany({
      where: { id: row.id },
      data: { changeOrders: new Prisma.Decimal(row.derived.toFixed(2)) },
    });
    updated += result.count;
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
