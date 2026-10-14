import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";

const bodySchema = z.object({
  year: z.number().int().min(2000).max(3000),
  /** Optional: only jobs whose primary salesperson has this id. */
  salespersonId: z.string().min(1).optional().nullable(),
  /** Last job id processed by the previous batch. */
  cursor: z.string().optional().nullable(),
  batchSize: z.number().int().min(1).max(100).optional(),
});

/** Forced commission recalc for one batch of jobs in a year; the client loops until `nextCursor` is null. */
export async function POST(req: Request) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { year, salespersonId, cursor, batchSize = 25 } = parsed.data;

  const where: Prisma.JobWhereInput = {
    year,
    ...(salespersonId ? { salespersonId } : {}),
    ...(cursor ? { id: { gt: cursor } } : {}),
  };

  try {
    const total = cursor ? undefined : await prisma.job.count({ where: { year, ...(salespersonId ? { salespersonId } : {}) } });
    const jobs = await prisma.job.findMany({
      where,
      select: { id: true, jobNumber: true },
      orderBy: { id: "asc" },
      take: batchSize,
    });

    const failed: string[] = [];
    for (const job of jobs) {
      try {
        await recalculateJobAndCommissions(job.id, {
          forceCommissionRecalc: true,
          forceCommissionRecalcReason: "api.admin.commissions.recalculate_year",
        });
      } catch (error) {
        console.error(error);
        failed.push(job.jobNumber);
      }
    }

    const nextCursor = jobs.length === batchSize ? jobs[jobs.length - 1].id : null;
    if (!nextCursor) {
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "COMMISSIONS_RECALCULATED_FOR_YEAR",
          entityType: "Job",
          entityId: "bulk",
          payload: { year, salespersonId: salespersonId ?? null },
        },
      });
    }

    return NextResponse.json({ ok: true, processed: jobs.length, failed, nextCursor, total });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
