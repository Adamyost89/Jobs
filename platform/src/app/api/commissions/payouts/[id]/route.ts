import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canModifyData } from "@/lib/rbac";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";

const patchSchema = z
  .object({
    amount: z.number().finite().positive().optional(),
    notes: z
      .string()
      .max(500, "Notes can be at most 500 characters.")
      .nullable()
      .optional(),
  })
  .refine((v) => v.amount !== undefined || v.notes !== undefined, {
    message: "Provide amount and/or notes",
  });

async function applyCommissionDelta(
  tx: Prisma.TransactionClient,
  payout: { jobId: string | null; salespersonId: string; amount: Prisma.Decimal },
  deltaAmount: number
) {
  if (!payout.jobId || Math.abs(deltaAmount) < 0.0005) return;

  const commission = await tx.commission.findUnique({
    where: {
      jobId_salespersonId: {
        jobId: payout.jobId,
        salespersonId: payout.salespersonId,
      },
    },
  });
  if (!commission) return;

  const paid = commission.paidAmount.toNumber();
  const owed = commission.owedAmount.toNumber();
  const nextPaid = Math.max(0, paid + deltaAmount);
  const nextOwed = Math.max(0, owed - deltaAmount);

  await tx.commission.update({
    where: { id: commission.id },
    data: {
      paidAmount: new Prisma.Decimal(nextPaid.toFixed(2)),
      owedAmount: new Prisma.Decimal(nextOwed.toFixed(2)),
    },
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || !canModifyData(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.commissionPayout.findUnique({
    where: { id },
    select: {
      id: true,
      jobId: true,
      salespersonId: true,
      payPeriodLabel: true,
      amount: true,
      notes: true,
      createdAt: true,
    },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const amount = parsed.data.amount ?? existing.amount.toNumber();
  const notes =
    parsed.data.notes === undefined ? existing.notes : parsed.data.notes?.trim() ? parsed.data.notes.trim() : null;
  const deltaAmount = amount - existing.amount.toNumber();

  const updated = await prisma.$transaction(async (tx) => {
    await applyCommissionDelta(tx, existing, deltaAmount);
    const payout = await tx.commissionPayout.update({
      where: { id },
      data: {
        amount: new Prisma.Decimal(amount.toFixed(2)),
        notes,
      },
      select: {
        id: true,
        amount: true,
        notes: true,
        payPeriodLabel: true,
        createdAt: true,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "PAYOUT_LINE_EDIT",
        entityType: "CommissionPayout",
        entityId: id,
        payload: {
          before: {
            amount: existing.amount.toNumber(),
            notes: existing.notes,
            payPeriodLabel: existing.payPeriodLabel,
          },
          after: {
            amount,
            notes,
            payPeriodLabel: existing.payPeriodLabel,
          },
        },
      },
    });
    return payout;
  });

  if (existing.jobId) {
    await recalculateJobAndCommissions(existing.jobId);
  }

  return NextResponse.json({
    payout: {
      ...updated,
      amount: updated.amount.toNumber(),
    },
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || !canModifyData(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const existing = await prisma.commissionPayout.findUnique({
    where: { id },
    select: {
      id: true,
      jobId: true,
      salespersonId: true,
      payPeriodLabel: true,
      amount: true,
      notes: true,
      createdAt: true,
    },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await applyCommissionDelta(tx, existing, -existing.amount.toNumber());
    await tx.commissionPayout.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "PAYOUT_LINE_DELETE",
        entityType: "CommissionPayout",
        entityId: id,
        payload: {
          amount: existing.amount.toNumber(),
          notes: existing.notes,
          payPeriodLabel: existing.payPeriodLabel,
          createdAt: existing.createdAt.toISOString(),
        },
      },
    });
  });

  if (existing.jobId) {
    await recalculateJobAndCommissions(existing.jobId);
  }

  return NextResponse.json({ ok: true });
}
