import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canMarkCommissionPaid } from "@/lib/rbac";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";
import { formatIsoDateForPayrollTz, getCurrentPayPeriodLabel, getPayPeriodForPayday, parseIsoDateAtNoonUtc } from "@/lib/pay-period";

const bodySchema = z.object({
  commissionId: z.string(),
  /** Optional payday (YYYY-MM-DD). If present, pay period is inferred from this date. */
  payday: z.string().optional().nullable(),
  /** Backward-compatible manual override for older clients. */
  payPeriodLabel: z.string().optional().nullable(),
  amount: z.number().positive().optional(),
});

export async function POST(req: Request) {
  const user = await getSession();
  if (!user || !canMarkCommissionPaid(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { commissionId, payday, payPeriodLabel, amount } = parsed.data;
  const trimmedPayday = payday ? String(payday).trim() : "";
  const paydayDate = trimmedPayday ? parseIsoDateAtNoonUtc(trimmedPayday) : null;
  if (trimmedPayday && !paydayDate) {
    return NextResponse.json({ error: "Invalid payday date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  const label = paydayDate
    ? getPayPeriodForPayday(paydayDate).label
    : payPeriodLabel && String(payPeriodLabel).trim()
      ? String(payPeriodLabel).trim()
      : getCurrentPayPeriodLabel();

  try {
    const jobId = await prisma.$transaction(async (tx) => {
      const c = await tx.commission.findUnique({
        where: { id: commissionId },
        include: { job: true, salesperson: true },
      });
      if (!c) throw new Error("NOT_FOUND");
      if (c.override) throw new Error("OVERRIDE_LOCKED");
      const payAmt = amount ?? c.owedAmount.toNumber();
      if (payAmt <= 0) throw new Error("NO_AMOUNT");

      const newPaid = c.paidAmount.toNumber() + payAmt;
      const newOwed = Math.max(0, c.owedAmount.toNumber() - payAmt);
      await tx.commission.update({
        where: { id: commissionId },
        data: {
          paidAmount: new Prisma.Decimal(newPaid.toFixed(2)),
          owedAmount: new Prisma.Decimal(newOwed.toFixed(2)),
        },
      });
      await tx.commissionPayout.create({
        data: {
          salespersonId: c.salespersonId,
          jobId: c.jobId,
          payPeriodLabel: label,
          amount: new Prisma.Decimal(payAmt.toFixed(2)),
          notes: `Paid by ${user.email}${paydayDate ? `; payday ${formatIsoDateForPayrollTz(paydayDate)}` : ""}`,
          recordedByUserId: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "COMMISSION_PAID",
          entityType: "Commission",
          entityId: commissionId,
          payload: { payPeriodLabel: label, payday: paydayDate ? formatIsoDateForPayrollTz(paydayDate) : null, amount: payAmt },
        },
      });
      return c.jobId;
    });

    await recalculateJobAndCommissions(jobId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (msg === "OVERRIDE_LOCKED") {
      return NextResponse.json({ error: "Commission is override-locked" }, { status: 400 });
    }
    if (msg === "NO_AMOUNT") {
      return NextResponse.json({ error: "Nothing to pay" }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
