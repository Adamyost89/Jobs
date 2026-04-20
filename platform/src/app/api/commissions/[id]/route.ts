import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canEditCommissions } from "@/lib/rbac";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";

const patchSchema = z
  .object({
    override: z.boolean().optional(),
    owedAmount: z.number().finite().nonnegative().optional(),
    paidAmount: z.number().finite().nonnegative().optional(),
  })
  .refine((d) => d.override !== undefined || d.owedAmount !== undefined || d.paidAmount !== undefined, {
    message: "Provide override and/or owedAmount/paidAmount",
  });

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user || !canEditCommissions(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.commission.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const p = parsed.data;
  const data: Prisma.CommissionUpdateInput = {};
  if (p.paidAmount !== undefined) {
    data.paidAmount = new Prisma.Decimal(p.paidAmount.toFixed(2));
  }
  if (p.owedAmount !== undefined) {
    data.owedAmount = new Prisma.Decimal(p.owedAmount.toFixed(2));
  }
  if (p.paidAmount !== undefined || p.owedAmount !== undefined) {
    data.override = true;
  } else if (p.override !== undefined) {
    data.override = p.override;
  }

  const row = await prisma.commission.update({
    where: { id },
    data,
    include: { job: true, salesperson: true },
  });

  const action =
    p.paidAmount !== undefined || p.owedAmount !== undefined
      ? "COMMISSION_ADMIN_EDIT"
      : p.override === false
        ? "COMMISSION_OVERRIDE_CLEAR"
        : "COMMISSION_OVERRIDE";

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action,
      entityType: "Commission",
      entityId: id,
      payload: p,
    },
  });

  if (p.override === false && p.paidAmount === undefined && p.owedAmount === undefined) {
    await recalculateJobAndCommissions(row.jobId);
    const refreshed = await prisma.commission.findUnique({
      where: { id },
      include: { job: true, salesperson: true },
    });
    return NextResponse.json({ commission: refreshed ?? row });
  }

  return NextResponse.json({ commission: row });
}
