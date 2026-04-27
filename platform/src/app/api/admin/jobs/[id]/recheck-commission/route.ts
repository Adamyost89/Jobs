import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";

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

    const [after, payoutAgg] = await Promise.all([
      prisma.commission.count({ where: { jobId: id } }),
      prisma.commissionPayout.aggregate({
        where: { jobId: id },
        _count: { id: true },
        _sum: { amount: true },
      }),
    ]);

    const payoutCount = payoutAgg._count.id ?? 0;
    const payoutSum = payoutAgg._sum.amount?.toNumber() ?? 0;

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
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
