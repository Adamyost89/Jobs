import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canEditJobs } from "@/lib/rbac";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";
import { normalizeStatus } from "@/lib/status";

const patchSchema = z
  .object({
    name: z.string().optional().nullable(),
    leadNumber: z.string().optional().nullable(),
    contractAmount: z.number().optional(),
    changeOrders: z.number().optional(),
    invoicedTotal: z.number().optional(),
    projectRevenue: z.number().optional(),
    cost: z.number().optional(),
    status: z.string().optional(),
    paidInFull: z.boolean().optional(),
    invoiceFlag: z.boolean().optional(),
    paidDate: z.union([z.string(), z.null()]).optional(),
    drewParticipation: z.string().optional().nullable(),
  })
  .partial();

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!canEditJobs(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const p = parsed.data;
  const data: Prisma.JobUpdateInput = {};
  if (p.name !== undefined) data.name = p.name;
  if (p.leadNumber !== undefined) data.leadNumber = p.leadNumber;
  if (p.contractAmount !== undefined) data.contractAmount = new Prisma.Decimal(p.contractAmount.toFixed(2));
  if (p.changeOrders !== undefined) data.changeOrders = new Prisma.Decimal(p.changeOrders.toFixed(2));
  if (p.invoicedTotal !== undefined) data.invoicedTotal = new Prisma.Decimal(p.invoicedTotal.toFixed(2));
  if (p.projectRevenue !== undefined) data.projectRevenue = new Prisma.Decimal(p.projectRevenue.toFixed(2));
  if (p.cost !== undefined) data.cost = new Prisma.Decimal(p.cost.toFixed(2));
  if (p.status !== undefined) data.status = normalizeStatus(p.status);
  if (p.paidInFull !== undefined) data.paidInFull = p.paidInFull;
  if (p.invoiceFlag !== undefined) data.invoiceFlag = p.invoiceFlag;
  if (p.paidDate !== undefined) {
    data.paidDate =
      p.paidDate === null || p.paidDate === ""
        ? null
        : new Date(p.paidDate as string);
  }
  if (p.drewParticipation !== undefined) data.drewParticipation = p.drewParticipation;

  await prisma.job.update({
    where: { id },
    data,
  });
  await prisma.jobEvent.create({
    data: {
      jobId: id,
      type: "JOB_UPDATED",
      source: "api",
      payload: { by: user.id, patch: p },
    },
  });
  await recalculateJobAndCommissions(id);
  const full = await prisma.job.findUnique({
    where: { id },
    include: { salesperson: true, commissions: { include: { salesperson: true } } },
  });
  return NextResponse.json({ job: full });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const job = await prisma.job.findUnique({
    where: { id },
    select: { id: true, jobNumber: true, year: true },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!canEditJobs(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.commissionPayout.updateMany({
      where: { jobId: id },
      data: { jobId: null },
    });
    await tx.billedProjectLine.updateMany({
      where: { jobId: id },
      data: { jobId: null },
    });
    await tx.job.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "JOB_DELETED",
        entityType: "Job",
        entityId: id,
        payload: { jobNumber: job.jobNumber, year: job.year },
      },
    });
  });

  return NextResponse.json({ ok: true, releasedJobNumber: job.jobNumber });
}
