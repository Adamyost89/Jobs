import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeStatus } from "@/lib/status";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";

/**
 * Generic Zapier-friendly bridge: update job row by lead (column A) and year sheet.
 * Secured with ZAPIER_BRIDGE_SECRET as Bearer token or X-Bridge-Secret header.
 */
const bodySchema = z.object({
  yearSheet: z.enum(["2024", "2025", "2026"]),
  leadNumber: z.string(),
  patch: z
    .object({
      invoicedDelta: z.number().optional(),
      setInvoiceFlag: z.boolean().optional(),
      paidInFull: z.boolean().optional(),
      status: z.string().optional(),
      projectRevenue: z.number().optional(),
      paidDate: z.string().nullable().optional(),
    })
    .partial(),
});

export async function POST(req: Request) {
  const secret = process.env.ZAPIER_BRIDGE_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const hdr = req.headers.get("x-bridge-secret");
    if (auth !== `Bearer ${secret}` && hdr !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { yearSheet, leadNumber, patch } = parsed.data;
  const year = parseInt(yearSheet, 10);

  const job = await prisma.job.findFirst({
    where: { leadNumber, year },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const data: Prisma.JobUpdateInput = {};
  if (patch.invoicedDelta !== undefined) {
    const n = job.invoicedTotal.toNumber() + patch.invoicedDelta;
    data.invoicedTotal = new Prisma.Decimal(Math.max(0, n).toFixed(2));
  }
  if (patch.setInvoiceFlag !== undefined) data.invoiceFlag = patch.setInvoiceFlag;
  if (patch.paidInFull !== undefined) data.paidInFull = patch.paidInFull;
  if (patch.status !== undefined) data.status = normalizeStatus(patch.status);
  if (patch.projectRevenue !== undefined) {
    data.projectRevenue = new Prisma.Decimal(patch.projectRevenue.toFixed(2));
  }
  if (patch.paidDate !== undefined) {
    data.paidDate = patch.paidDate ? new Date(patch.paidDate) : null;
  }

  await prisma.job.update({ where: { id: job.id }, data });
  await prisma.jobEvent.create({
    data: {
      jobId: job.id,
      type: "ZAPIER_BRIDGE",
      source: "zapier",
      payload: json as object,
    },
  });
  await recalculateJobAndCommissions(job.id);
  return NextResponse.json({ ok: true, jobId: job.id });
}
