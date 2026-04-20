import { Prisma, type Job } from "@prisma/client";
import { prisma } from "./db";
import { normalizeStatus } from "./status";
import { computeCommissionsForJob } from "./commission-rules";
import { skipAutoCommissionRecalcForJobYear } from "./commission-import-policy";
import { commissionPlanForJobYear } from "./commission-plan-defaults";
import { loadCommissionTierTotalsForYear } from "./commission-tier-totals";
import { loadSalespersonFlagsByName } from "./salespeople-kind-db";

function dec(n: Prisma.Decimal | number | string): number {
  if (n instanceof Prisma.Decimal) return n.toNumber();
  return Number(n) || 0;
}

type DecLike = Prisma.Decimal | number | string;

/** Realized GP only when cost is entered and the job is paid in full (invoice settled). */
export function shouldFigureJobGp(job: { cost: DecLike; paidInFull: boolean }): boolean {
  return dec(job.cost) > 0 && job.paidInFull === true;
}

/** Show sheet / imported GP when we are not replacing it with realized GP. */
export function hasDisplayableGp(job: {
  gp: DecLike;
  gpPercent: DecLike;
  cost: DecLike;
  paidInFull: boolean;
}): boolean {
  if (shouldFigureJobGp(job)) return true;
  return Math.abs(dec(job.gp)) > 0.0005 || Math.abs(dec(job.gpPercent)) > 0.0005;
}

export function computeGpFields(job: Pick<Job, "contractAmount" | "changeOrders" | "cost" | "paidInFull">) {
  if (!shouldFigureJobGp(job)) {
    return {
      gp: new Prisma.Decimal("0"),
      gpPercent: new Prisma.Decimal("0"),
    };
  }
  const contract = dec(job.contractAmount);
  const co = dec(job.changeOrders);
  const cost = dec(job.cost);
  const revenue = contract + co;
  const gp = revenue - cost;
  const gpPercent = revenue > 0 ? (gp / revenue) * 100 : 0;
  return {
    gp: new Prisma.Decimal(gp.toFixed(2)),
    gpPercent: new Prisma.Decimal(gpPercent.toFixed(4)),
  };
}

export async function allocateNextJobNumber(year: number): Promise<string> {
  const prefix = String(year);
  const jobs = await prisma.job.findMany({
    where: { jobNumber: { startsWith: prefix } },
    select: { jobNumber: true },
  });
  const used = new Set<number>();
  for (const j of jobs) {
    const rest = j.jobNumber.slice(prefix.length);
    const n = parseInt(rest, 10);
    if (!isNaN(n) && n > 0) used.add(n);
  }
  let next = 1;
  while (used.has(next)) {
    next += 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export async function recalculateJobAndCommissions(jobId: string) {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      commissions: { include: { salesperson: true } },
      salesperson: true,
    },
  });
  const { gp: computedGp, gpPercent: computedGpPct } = computeGpFields(job);
  const gp = shouldFigureJobGp(job) ? computedGp : job.gp;
  const gpPercent = shouldFigureJobGp(job) ? computedGpPct : job.gpPercent;
  const normalized = normalizeStatus(job.status);
  await prisma.job.update({
    where: { id: jobId },
    data: { gp, gpPercent, status: normalized },
  });

  if (skipAutoCommissionRecalcForJobYear(job.year)) {
    return;
  }

  const jobIdNum = parseInt(String(job.leadNumber || ""), 10) || 0;

  const basis = dec(job.projectRevenue) > 0 ? dec(job.projectRevenue) : dec(job.contractAmount) + dec(job.changeOrders);
  const commissionableTotal = dec(job.invoicedTotal) > 0 ? dec(job.invoicedTotal) : basis;
  const customerPaid =
    dec(job.amountPaid ?? 0) > 0
      ? dec(job.amountPaid ?? 0)
      : job.paidInFull
        ? commissionableTotal
        : 0;

  const planRow = await prisma.commissionPlan.findUnique({ where: { year: job.year } });
  const plan = commissionPlanForJobYear(job.year, planRow?.config);

  const [tierTotals, flags] = await Promise.all([
    loadCommissionTierTotalsForYear(job.year),
    loadSalespersonFlagsByName(),
  ]);
  const { kindByName: kindBySalespersonName, activeByName: activeBySalespersonName } = flags;
  const existingCommissionNamesOnJob = new Set(job.commissions.map((c) => c.salesperson.name));

  const rows = computeCommissionsForJob({
    year: job.year,
    leadNumber: job.leadNumber,
    jobIdNum,
    basis,
    customerPaid,
    commissionableTotal,
    paidInFull: job.paidInFull,
    primarySalespersonName: job.salesperson?.name ?? null,
    drewParticipation: job.drewParticipation,
    existingPaidBySalesperson: Object.fromEntries(
      job.commissions.map((c) => [c.salesperson.name, dec(c.paidAmount)])
    ),
    overrides: Object.fromEntries(
      job.commissions.filter((c) => c.override).map((c) => [c.salesperson.name, true])
    ),
    plan,
    tierTotals,
    kindBySalespersonName,
    activeBySalespersonName,
    existingCommissionNamesOnJob,
  });

  const computedNames = new Set(rows.map((r) => r.salespersonName));
  const stale = job.commissions.filter(
    (c) => !c.override && !computedNames.has(c.salesperson.name)
  );
  if (stale.length) {
    await prisma.commission.deleteMany({
      where: { id: { in: stale.map((c) => c.id) } },
    });
  }

  for (const row of rows) {
    const sp = await prisma.salesperson.findUnique({ where: { name: row.salespersonName } });
    if (!sp) continue;
    if (row.overrideSkip) continue;
    await prisma.commission.upsert({
      where: {
        jobId_salespersonId: { jobId: job.id, salespersonId: sp.id },
      },
      create: {
        jobId: job.id,
        salespersonId: sp.id,
        paidAmount: new Prisma.Decimal(row.paid.toFixed(2)),
        owedAmount: new Prisma.Decimal(row.owed.toFixed(2)),
        override: false,
      },
      update: {
        owedAmount: new Prisma.Decimal(row.owed.toFixed(2)),
      },
    });
  }
}
