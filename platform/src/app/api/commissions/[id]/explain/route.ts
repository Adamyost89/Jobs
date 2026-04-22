import { NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { commissionPlanForJobYear } from "@/lib/commission-plan-defaults";
import { loadCommissionTierTotalsForYear } from "@/lib/commission-tier-totals";
import { loadSalespersonFlagsByName } from "@/lib/salespeople-kind-db";
import { explainCommissionForSalesperson } from "@/lib/commission-rules";
import { commissionDisplayAmounts } from "@/lib/commission-display";

function dec(n: Prisma.Decimal | number | string | null | undefined): number {
  if (n === null || n === undefined) return 0;
  if (n instanceof Prisma.Decimal) return n.toNumber();
  return Number(n) || 0;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const row = await prisma.commission.findUnique({
    where: { id },
    include: {
      job: {
        include: {
          salesperson: true,
          commissions: { include: { salesperson: true } },
        },
      },
      salesperson: true,
    },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const basis =
    dec(row.job.projectRevenue) > 0
      ? dec(row.job.projectRevenue)
      : dec(row.job.contractAmount) + dec(row.job.changeOrders);
  const commissionableTotal = dec(row.job.invoicedTotal) > 0 ? dec(row.job.invoicedTotal) : basis;
  const customerPaid = Math.max(0, dec(row.job.amountPaid ?? 0));
  const jobIdNum = parseInt(String(row.job.leadNumber || ""), 10) || 0;

  const [planRow, tierTotals, flags, payoutSumRaw] = await Promise.all([
    prisma.commissionPlan.findUnique({ where: { year: row.job.year } }),
    loadCommissionTierTotalsForYear(row.job.year),
    loadSalespersonFlagsByName(),
    prisma.commissionPayout.aggregate({
      where: {
        jobId: row.jobId,
        salespersonId: row.salespersonId,
      },
      _sum: { amount: true },
    }),
  ]);

  const plan = commissionPlanForJobYear(row.job.year, planRow?.config);
  const payoutSum = dec(payoutSumRaw._sum.amount);
  const ledgerPaid = dec(row.paidAmount);
  const ledgerOwed = dec(row.owedAmount);
  const { displayPaid, displayOwed } = commissionDisplayAmounts(
    ledgerPaid,
    ledgerOwed,
    payoutSum,
    row.salesperson.active
  );

  const explain = explainCommissionForSalesperson(
    {
      year: row.job.year,
      leadNumber: row.job.leadNumber,
      jobIdNum,
      basis,
      customerPaid,
      commissionableTotal,
      paidInFull: row.job.paidInFull,
      primarySalespersonName: row.job.salesperson?.name ?? null,
      drewParticipation: row.job.drewParticipation,
      existingPaidBySalesperson: Object.fromEntries(
        row.job.commissions.map((c) => [c.salesperson.name, dec(c.paidAmount)])
      ),
      overrides: Object.fromEntries(
        row.job.commissions.filter((c) => c.override).map((c) => [c.salesperson.name, true])
      ),
      plan,
      tierTotals,
      kindBySalespersonName: flags.kindByName,
      activeBySalespersonName: flags.activeByName,
      existingCommissionNamesOnJob: new Set(row.job.commissions.map((c) => c.salesperson.name)),
    },
    row.salesperson.name
  );

  return NextResponse.json({
    commissionId: row.id,
    salespersonName: row.salesperson.name,
    jobNumber: row.job.jobNumber,
    year: row.job.year,
    leadNumber: row.job.leadNumber,
    explain,
    storedLine: {
      ledgerPaid,
      ledgerOwed,
      payoutSum,
      displayPaid,
      displayOwed,
      override: row.override,
      salespersonActive: row.salesperson.active,
    },
  });
}
