import { NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { overrideLockWrite } from "@/lib/commission-override-lock";

const bodySchema = z.object({
  salespersonId: z.string().min(1),
  owedAmount: z.number().finite().nonnegative(),
  paidAmount: z.number().finite().nonnegative().optional(),
});

/** Super admin: add a commission on a job. The amount stacks on any line already there for that person. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a salesperson and a commission amount." }, { status: 400 });
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, jobNumber: true, amountPaid: true },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const salesperson = await prisma.salesperson.findUnique({
    where: { id: parsed.data.salespersonId },
    select: { id: true, name: true },
  });
  if (!salesperson) return NextResponse.json({ error: "Salesperson not found" }, { status: 404 });

  const addOwed = Math.round(parsed.data.owedAmount * 100) / 100;
  const addPaid = Math.round((parsed.data.paidAmount ?? 0) * 100) / 100;
  if (addOwed <= 0 && addPaid <= 0) {
    return NextResponse.json({ error: "Enter a commission amount greater than zero." }, { status: 400 });
  }

  const existing = await prisma.commission.findUnique({
    where: { jobId_salespersonId: { jobId, salespersonId: salesperson.id } },
    select: { owedAmount: true, paidAmount: true },
  });
  const owed = (existing ? existing.owedAmount.toNumber() : 0) + addOwed;
  const paid = (existing ? existing.paidAmount.toNumber() : 0) + addPaid;
  const customerPaid = Math.max(0, job.amountPaid?.toNumber() ?? 0);
  const lock = overrideLockWrite(customerPaid, owed, paid);

  const commission = await prisma.commission.upsert({
    where: { jobId_salespersonId: { jobId, salespersonId: salesperson.id } },
    create: {
      jobId,
      salespersonId: salesperson.id,
      owedAmount: new Prisma.Decimal(owed.toFixed(2)),
      paidAmount: new Prisma.Decimal(paid.toFixed(2)),
      ...lock,
    },
    update: {
      owedAmount: new Prisma.Decimal(owed.toFixed(2)),
      paidAmount: new Prisma.Decimal(paid.toFixed(2)),
      ...lock,
    },
    select: { id: true, owedAmount: true, paidAmount: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "COMMISSION_ADDED_ON_JOB",
      entityType: "Commission",
      entityId: commission.id,
      payload: {
        jobId,
        jobNumber: job.jobNumber,
        salespersonId: salesperson.id,
        salespersonName: salesperson.name,
        addedOwed: addOwed,
        addedPaid: addPaid,
        owed,
        paid,
        customerPaid,
      },
    },
  });

  return NextResponse.json({
    commission: {
      id: commission.id,
      salespersonName: salesperson.name,
      owedAmount: commission.owedAmount.toNumber(),
      paidAmount: commission.paidAmount.toNumber(),
    },
  });
}
