import { Prisma, type Job } from "@prisma/client";
import { prisma } from "./db";
import { computeCommissionsForJob } from "./commission-rules";
import { skipAutoCommissionRecalcForJobYear } from "./commission-import-policy";
import { commissionPlanForJobYear } from "./commission-plan-defaults";
import { loadCommissionTierTotalsForYear } from "./commission-tier-totals";
import { loadSalespersonFlagsByName } from "./salespeople-kind-db";
import { resolveOrCreateSalespersonByName } from "./salesperson-name";
import { deriveChangeOrdersNumber, moneyEq } from "./change-orders";

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
  const minSequence = 5001;
  const jobs = await prisma.job.findMany({
    where: { jobNumber: { startsWith: prefix } },
    select: { jobNumber: true },
  });
  const used = new Set<number>();
  for (const j of jobs) {
    const rest = j.jobNumber.slice(prefix.length);
    const n = parseInt(rest, 10);
    if (!isNaN(n) && n >= minSequence) used.add(n);
  }
  let next = minSequence;
  while (used.has(next)) {
    next += 1;
  }
  return `${prefix}${String(next)}`;
}

type RecalculateJobOptions = {
  forceCommissionRecalc?: boolean;
  forceCommissionRecalcReason?: string;
};

export async function recalculateJobAndCommissions(jobId: string, opts: RecalculateJobOptions = {}) {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      commissions: { include: { salesperson: true } },
      salesperson: true,
    },
  });
  const derivedChangeOrders = deriveChangeOrdersNumber(job.contractAmount, job.amountPaid);
  const effectiveChangeOrders =
    derivedChangeOrders !== null ? derivedChangeOrders : dec(job.changeOrders);
  const gpJob = {
    ...job,
    changeOrders: new Prisma.Decimal(effectiveChangeOrders.toFixed(2)),
  };
  const { gp: computedGp, gpPercent: computedGpPct } = computeGpFields(gpJob);
  const gp = shouldFigureJobGp(job) ? computedGp : job.gp;
  const gpPercent = shouldFigureJobGp(job) ? computedGpPct : job.gpPercent;
  const updateData: Prisma.JobUpdateInput = { gp, gpPercent };
  if (derivedChangeOrders !== null && !moneyEq(effectiveChangeOrders, dec(job.changeOrders))) {
    updateData.changeOrders = new Prisma.Decimal(effectiveChangeOrders.toFixed(2));
  }
  await prisma.job.update({
    where: { id: jobId },
    data: updateData,
  });

  const cfg = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { cutoverComplete: true },
  });
  if (opts.forceCommissionRecalc) {
    await prisma.jobEvent.create({
      data: {
        jobId: job.id,
        type: "COMMISSION_RECALC_FORCED_PAYMENT",
        source: "workflow",
        payload: {
          reason: opts.forceCommissionRecalcReason ?? "unspecified",
          jobYear: job.year,
          cutoverComplete: cfg?.cutoverComplete ?? false,
        },
      },
    });
  }
  if (!opts.forceCommissionRecalc && skipAutoCommissionRecalcForJobYear(job.year, cfg?.cutoverComplete ?? false)) {
    return;
  }

  const jobIdNum = parseInt(String(job.leadNumber || ""), 10) || 0;

  const basis = dec(job.projectRevenue) > 0 ? dec(job.projectRevenue) : dec(job.contractAmount) + effectiveChangeOrders;
  const commissionableTotal = dec(job.invoicedTotal) > 0 ? dec(job.invoicedTotal) : basis;
  // Commission earning follows actual customer cash collected (Amount Paid) only.
  const customerPaid = Math.max(0, dec(job.amountPaid ?? 0));

  const planRow = await prisma.commissionPlan.findUnique({ where: { year: job.year } });
  const plan = commissionPlanForJobYear(job.year, planRow?.config);

  const [tierTotals, flags, payoutRows] = await Promise.all([
    loadCommissionTierTotalsForYear(job.year),
    loadSalespersonFlagsByName(),
    prisma.commissionPayout.findMany({
      where: { jobId: job.id },
      select: {
        amount: true,
        salesperson: { select: { name: true } },
      },
    }),
  ]);
  const { kindByName: kindBySalespersonName, activeByName: activeBySalespersonName } = flags;
  const existingCommissionNamesOnJob = new Set(job.commissions.map((c) => c.salesperson.name));
  const payoutPaidBySalesperson: Record<string, number> = {};
  for (const p of payoutRows) {
    const name = p.salesperson.name;
    payoutPaidBySalesperson[name] = (payoutPaidBySalesperson[name] ?? 0) + p.amount.toNumber();
  }
  const existingPaidBySalesperson = Object.fromEntries(
    job.commissions.map((c) => {
      const existingPaid = dec(c.paidAmount);
      const payoutPaid = payoutPaidBySalesperson[c.salesperson.name] ?? 0;
      return [c.salesperson.name, payoutPaid > 0 ? payoutPaid : existingPaid];
    })
  );

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
    existingPaidBySalesperson,
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
    const sp = await resolveOrCreateSalespersonByName(prisma, row.salespersonName, {
      preferFirstToken: true,
      activeOnCreate: true,
    });
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
        paidAmount: new Prisma.Decimal(row.paid.toFixed(2)),
        owedAmount: new Prisma.Decimal(row.owed.toFixed(2)),
      },
    });
  }
}

export async function recalculateAllJobsAndCommissions(): Promise<{ totalJobs: number }> {
  const jobs = await prisma.job.findMany({
    select: { id: true },
    orderBy: { jobNumber: "asc" },
    take: 20_000,
  });
  for (const job of jobs) {
    await recalculateJobAndCommissions(job.id);
  }
  return { totalJobs: jobs.length };
}
