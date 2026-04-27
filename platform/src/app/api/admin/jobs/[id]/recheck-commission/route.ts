import { NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";
import { COMMISSION_PLAN_VERSION, isCommissionPlanConfigV1, type CommissionPlanConfigV1 } from "@/lib/commission-plan-types";
import { loadCommissionTierTotalsForYear } from "@/lib/commission-tier-totals";
import { loadSalespersonFlagsByName } from "@/lib/salespeople-kind-db";
import { explainCommissionForSalesperson } from "@/lib/commission-rules";

function dec(n: Prisma.Decimal | number | string | null | undefined): number {
  if (n === null || n === undefined) return 0;
  if (n instanceof Prisma.Decimal) return n.toNumber();
  return Number(n) || 0;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const job = await prisma.job.findUnique({
    where: { id },
    select: { id: true, jobNumber: true, year: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const before = await prisma.commission.count({ where: { jobId: id } });

    await recalculateJobAndCommissions(id, {
      forceCommissionRecalc: true,
      forceCommissionRecalcReason: "api.admin.jobs.recheck_commission.button",
    });

    const [after, payoutAgg, refreshedJob, storedPlanRow] = await Promise.all([
      prisma.commission.count({ where: { jobId: id } }),
      prisma.commissionPayout.aggregate({
        where: { jobId: id },
        _count: { id: true },
        _sum: { amount: true },
      }),
      prisma.job.findUnique({
        where: { id },
        include: {
          salesperson: true,
          commissions: { include: { salesperson: true } },
        },
      }),
      prisma.commissionPlan.findUnique({ where: { year: job.year } }),
    ]);

    const payoutCount = payoutAgg._count.id ?? 0;
    const payoutSum = payoutAgg._sum.amount?.toNumber() ?? 0;
    const hasStoredPlan = !!storedPlanRow?.config;
    const storedPlanValid = isCommissionPlanConfigV1(storedPlanRow?.config);
    const plan: CommissionPlanConfigV1 = storedPlanValid
      ? (storedPlanRow!.config as CommissionPlanConfigV1)
      : {
          version: COMMISSION_PLAN_VERSION,
          people: {},
        };

    let zeroWhy: string[] = [];
    if (after === 0 && refreshedJob) {
      const basis =
        dec(refreshedJob.projectRevenue) > 0
          ? dec(refreshedJob.projectRevenue)
          : dec(refreshedJob.contractAmount) + dec(refreshedJob.changeOrders);
      const commissionableTotal = dec(refreshedJob.invoicedTotal) > 0 ? dec(refreshedJob.invoicedTotal) : basis;
      const customerPaid = Math.max(0, dec(refreshedJob.amountPaid ?? 0));
      const jobIdNum = parseInt(String(refreshedJob.leadNumber || ""), 10) || 0;
      const [tierTotals, flags] = await Promise.all([
        loadCommissionTierTotalsForYear(refreshedJob.year),
        loadSalespersonFlagsByName(),
      ]);
      const existingPaidBySalesperson = Object.fromEntries(
        refreshedJob.commissions.map((c) => [c.salesperson.name, dec(c.paidAmount)])
      );
      const overrides = Object.fromEntries(
        refreshedJob.commissions.filter((c) => c.override).map((c) => [c.salesperson.name, true])
      );
      const existingCommissionNamesOnJob = new Set(refreshedJob.commissions.map((c) => c.salesperson.name));
      const namesToExplain = new Set<string>([
        ...Object.keys(plan.people ?? {}),
        ...(refreshedJob.salesperson?.name ? [refreshedJob.salesperson.name] : []),
      ]);
      if (!hasStoredPlan) zeroWhy.push(`No stored commission plan found for year ${refreshedJob.year}.`);
      if (hasStoredPlan && !storedPlanValid) {
        zeroWhy.push(`Stored commission plan for year ${refreshedJob.year} is invalid JSON format.`);
      }
      if (storedPlanValid && Object.keys(plan.people).length === 0) {
        zeroWhy.push(`Stored commission plan for year ${refreshedJob.year} has zero people.`);
      }
      if (namesToExplain.size === 0) {
        zeroWhy.push("No salesperson names available to evaluate in the current plan or on the job.");
      } else {
        for (const name of namesToExplain) {
          const explain = explainCommissionForSalesperson(
            {
              year: refreshedJob.year,
              leadNumber: refreshedJob.leadNumber,
              jobIdNum,
              basis,
              customerPaid,
              commissionableTotal,
              paidInFull: refreshedJob.paidInFull,
              primarySalespersonName: refreshedJob.salesperson?.name ?? null,
              drewParticipation: refreshedJob.drewParticipation,
              existingPaidBySalesperson,
              overrides,
              plan,
              tierTotals,
              kindBySalespersonName: flags.kindByName,
              activeBySalespersonName: flags.activeByName,
              existingCommissionNamesOnJob,
            },
            name
          );
          zeroWhy.push(`${name}: ${explain.reason}`);
        }
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "JOB_RECHECK_COMMISSION",
        entityType: "Job",
        entityId: id,
        payload: {
          jobNumber: job.jobNumber,
          year: job.year,
          commissionCountBefore: before,
          commissionCountAfter: after,
          payoutCount,
          payoutSum,
          zeroWhy: zeroWhy.length > 0 ? zeroWhy : null,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      jobId: id,
      jobNumber: job.jobNumber,
      commissionCountBefore: before,
      commissionCountAfter: after,
      payoutCount,
      payoutSum,
      whyZero: zeroWhy,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
