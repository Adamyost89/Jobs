import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { commissionDisplayAmounts } from "./commission-display";

export async function syncCommissionLedgerFromPayouts(
  db: Pick<PrismaClient, "commission" | "commissionPayout">
): Promise<{
  scanned: number;
  updated: number;
}> {
  const commissions = await db.commission.findMany({
    where: { override: false },
    select: {
      id: true,
      jobId: true,
      salespersonId: true,
      paidAmount: true,
      owedAmount: true,
      salesperson: { select: { active: true } },
    },
  });

  const sums = await db.commissionPayout.groupBy({
    by: ["jobId", "salespersonId"],
    where: { jobId: { not: null } },
    _sum: { amount: true },
  });
  const sumMap = new Map<string, number>();
  for (const g of sums) {
    if (!g.jobId) continue;
    sumMap.set(`${g.jobId}|${g.salespersonId}`, g._sum.amount?.toNumber() ?? 0);
  }

  let updated = 0;
  for (const c of commissions) {
    const key = `${c.jobId}|${c.salespersonId}`;
    const payoutSum = sumMap.get(key) ?? 0;
    const { displayPaid, displayOwed } = commissionDisplayAmounts(
      c.paidAmount.toNumber(),
      c.owedAmount.toNumber(),
      payoutSum,
      c.salesperson.active
    );
    const lp = c.paidAmount.toNumber();
    const lo = c.owedAmount.toNumber();
    if (Math.abs(lp - displayPaid) < 0.02 && Math.abs(lo - displayOwed) < 0.02) continue;

    await db.commission.update({
      where: { id: c.id },
      data: {
        paidAmount: new Prisma.Decimal(displayPaid.toFixed(2)),
        owedAmount: new Prisma.Decimal(displayOwed.toFixed(2)),
      },
    });
    updated++;
  }

  return { scanned: commissions.length, updated };
}
