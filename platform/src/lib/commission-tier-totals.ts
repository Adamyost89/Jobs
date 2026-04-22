import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { CommissionTierTotals } from "./commission-plan-types";

function dec(n: Prisma.Decimal | number | string | null | undefined): number {
  if (n === null || n === undefined) return 0;
  if (n instanceof Prisma.Decimal) return n.toNumber();
  return Number(n) || 0;
}

function jobBasis(projectRevenue: Prisma.Decimal, contractAmount: Prisma.Decimal, changeOrders: Prisma.Decimal) {
  const pr = dec(projectRevenue);
  if (pr > 0) return pr;
  return dec(contractAmount) + dec(changeOrders);
}

/**
 * YTD aggregates per salesperson for the calendar job year. Used for bonus tiers
 * (paid commissions running total vs sold revenue vs cash collected on primary jobs).
 */
export async function loadCommissionTierTotalsForYear(year: number): Promise<CommissionTierTotals> {
  const salespeople = await prisma.salesperson.findMany({
    where: { active: true },
    select: { id: true, name: true },
  });
  const out: CommissionTierTotals = {};

  const paidRows = await prisma.commission.groupBy({
    by: ["salespersonId"],
    where: { job: { year } },
    _sum: { paidAmount: true },
  });
  const paidBySp = new Map(paidRows.map((r) => [r.salespersonId, dec(r._sum.paidAmount)]));

  const jobs = await prisma.job.findMany({
    where: { year, salespersonId: { not: null } },
    select: {
      salespersonId: true,
      projectRevenue: true,
      contractAmount: true,
      changeOrders: true,
      amountPaid: true,
    },
  });
  const basisBySp = new Map<string, number>();
  const paidAmountBySp = new Map<string, number>();
  for (const j of jobs) {
    if (!j.salespersonId) continue;
    const b = jobBasis(j.projectRevenue, j.contractAmount, j.changeOrders);
    basisBySp.set(j.salespersonId, (basisBySp.get(j.salespersonId) ?? 0) + b);
    paidAmountBySp.set(j.salespersonId, (paidAmountBySp.get(j.salespersonId) ?? 0) + dec(j.amountPaid));
  }

  for (const sp of salespeople) {
    out[sp.name] = {
      ytdPaid: paidBySp.get(sp.id) ?? 0,
      ytdPrimaryBasis: basisBySp.get(sp.id) ?? 0,
      ytdPrimaryPaidAmount: paidAmountBySp.get(sp.id) ?? 0,
    };
  }
  return out;
}
