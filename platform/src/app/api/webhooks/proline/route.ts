import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { allocateNextJobNumber, recalculateJobAndCommissions } from "@/lib/job-workflow";
import { normalizeProlineWebhookBody } from "@/lib/proline-webhook";
import {
  buildProlineProjectNameForAssignedJob,
  sendProlineNameWritebackViaZapier,
} from "@/lib/proline-name-writeback";

function asDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n.toFixed(2));
}

function statusFromWebhook(raw: string | undefined, fallback: string): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s || fallback;
}

function invoiceDeltaMarkerType(invoiceId: string): string {
  const safe = String(invoiceId)
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, "_")
    .slice(0, 120);
  return `PROLINE_INVOICE_DELTA_${safe || "UNKNOWN"}`;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "ProLine webhook endpoint (POST JSON payloads here)",
  });
}

export async function POST(req: Request) {
  const secret = process.env.PROLINE_WEBHOOK_SECRET;
  if (secret) {
    const h = req.headers.get("x-proline-signature") || req.headers.get("authorization");
    if (h !== secret && h !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const json = await req.json().catch(() => null);
  const normalized = normalizeProlineWebhookBody(json, {
    PROLINE_USER_MAP: process.env.PROLINE_USER_MAP,
  });

  if (!normalized.ok) {
    const err = normalized.error;
    const message = typeof err === "string" ? err : "Invalid payload";
    const details = typeof err === "string" ? undefined : err.flatten();
    return NextResponse.json({ error: message, details }, { status: 400 });
  }

  const e = normalized.event;
  const year = e.year ?? new Date().getFullYear();

  async function ensureRequiredNameWriteback(job: { id: string; jobNumber: string }, originalName: string | null | undefined) {
    const existing = await prisma.jobEvent.findFirst({
      where: { jobId: job.id, type: "PROLINE_NAME_WRITEBACK" },
      select: { id: true },
    });
    if (existing) return;

    const full = await prisma.job.findUnique({
      where: { id: job.id },
      select: { id: true, prolineJobId: true, leadNumber: true, jobNumber: true, name: true },
    });
    if (!full?.prolineJobId) return;

    const projectName = buildProlineProjectNameForAssignedJob(originalName ?? full.name, full.jobNumber);
    try {
      await sendProlineNameWritebackViaZapier({
        prolineJobId: full.prolineJobId,
        leadNumber: full.leadNumber,
        jobNumber: full.jobNumber,
        projectName,
      });
      await prisma.jobEvent.create({
        data: {
          jobId: full.id,
          type: "PROLINE_NAME_WRITEBACK",
          source: "zapier",
          payload: {
            prolineJobId: full.prolineJobId,
            leadNumber: full.leadNumber,
            projectName,
            jobNumber: full.jobNumber,
          },
        },
      });
    } catch (error) {
      await prisma.jobEvent.create({
        data: {
          jobId: full.id,
          type: "PROLINE_NAME_WRITEBACK_FAILED",
          source: "zapier",
          payload: {
            prolineJobId: full.prolineJobId,
            leadNumber: full.leadNumber,
            projectName,
            jobNumber: full.jobNumber,
            error: error instanceof Error ? error.message : String(error),
          },
        },
      });
      throw error;
    }
  }

  async function computeUpdateForExistingJob(existing: {
    id: string;
    invoicedTotal: Prisma.Decimal;
    amountPaid: Prisma.Decimal | null;
  }): Promise<{
    data: Prisma.JobUpdateInput;
    invoiceDeltaApplied: boolean;
    invoiceDeltaSkippedDuplicate: boolean;
  }> {
    const data: Prisma.JobUpdateInput = {};
    if (e.name !== undefined) data.name = e.name;
    if (e.leadNumber !== undefined) data.leadNumber = e.leadNumber;
    if (e.contractAmount !== undefined) {
      const c = asDecimal(e.contractAmount);
      data.contractAmount = c;
      data.projectRevenue = c;
    }
    if (e.status !== undefined) data.status = statusFromWebhook(e.status, "UNKNOWN");
    if (e.cost !== undefined) data.cost = asDecimal(e.cost);
    if (e.amountPaid !== undefined) {
      const paid = Math.max(0, e.amountPaid);
      data.amountPaid = asDecimal(paid);
    }
    if (e.paidInFull !== undefined) data.paidInFull = e.paidInFull;
    if (e.paidDate !== undefined) data.paidDate = e.paidDate ? new Date(e.paidDate) : null;

    let invoiceDeltaApplied = false;
    let invoiceDeltaSkippedDuplicate = false;
    if (e.invoicedDelta !== undefined && e.invoicedDelta !== 0) {
      let canApply = true;
      if (e.invoiceId) {
        const marker = await prisma.jobEvent.findFirst({
          where: { jobId: existing.id, type: invoiceDeltaMarkerType(e.invoiceId) },
          select: { id: true },
        });
        canApply = !marker;
        invoiceDeltaSkippedDuplicate = !!marker;
      }
      if (canApply) {
        const next = existing.invoicedTotal.toNumber() + e.invoicedDelta;
        data.invoicedTotal = asDecimal(Math.max(0, next));
        data.invoiceFlag = true;
        invoiceDeltaApplied = true;
      }
    }

    if (e.internalType === "invoice" && e.invoicedDelta === undefined) {
      data.invoiceFlag = true;
    }

    return { data, invoiceDeltaApplied, invoiceDeltaSkippedDuplicate };
  }

  async function createJob() {
    const dup = await prisma.job.findFirst({ where: { prolineJobId: e.prolineJobId } });
    if (dup) {
      return { kind: "dedupe" as const, job: dup };
    }
    const jobNumber = await allocateNextJobNumber(year);
    let salespersonId: string | null = null;
    if (e.salespersonName) {
      const sp = await prisma.salesperson.upsert({
        where: { name: e.salespersonName },
        create: { name: e.salespersonName },
        update: {},
      });
      salespersonId = sp.id;
    }
    const contract = new Prisma.Decimal((e.contractAmount ?? 0).toFixed(2));
    const job = await prisma.job.create({
      data: {
        jobNumber,
        year,
        leadNumber: e.leadNumber ?? null,
        name: e.name ?? null,
        contractAmount: contract,
        projectRevenue: contract,
        cost: asDecimal(Math.max(0, e.cost ?? 0)),
        amountPaid: e.amountPaid !== undefined ? asDecimal(Math.max(0, e.amountPaid)) : null,
        salespersonId,
        prolineJobId: e.prolineJobId,
        status: statusFromWebhook(e.status, "UNKNOWN"),
        paidInFull: e.paidInFull ?? false,
        paidDate: e.paidDate ? new Date(e.paidDate) : null,
      },
    });
    await prisma.jobEvent.create({
      data: {
        jobId: job.id,
        type: "PROLINE_SIGNED",
        source: "proline",
        payload: e.raw as object,
      },
    });
    await recalculateJobAndCommissions(job.id);
    await ensureRequiredNameWriteback(job, e.name);
    return { kind: "created" as const, job };
  }

  if (e.internalType === "job.signed") {
    const r = await createJob();
    if (r.kind === "dedupe") {
      await ensureRequiredNameWriteback(r.job, e.name);
      return NextResponse.json({
        jobNumber: r.job.jobNumber,
        jobId: r.job.id,
        deduped: true,
      });
    }
    return NextResponse.json({ jobNumber: r.job.jobNumber, jobId: r.job.id });
  }

  if (e.internalType === "job.upsert") {
    const existing = await prisma.job.findFirst({
      where: { prolineJobId: e.prolineJobId },
    });
    if (!existing) {
      const r = await createJob();
      if (r.kind === "dedupe") {
        await ensureRequiredNameWriteback(r.job, e.name);
        return NextResponse.json({
          jobNumber: r.job.jobNumber,
          jobId: r.job.id,
          deduped: true,
        });
      }
      return NextResponse.json({ jobNumber: r.job.jobNumber, jobId: r.job.id, upsert: "created" });
    }
    const { data, invoiceDeltaApplied, invoiceDeltaSkippedDuplicate } = await computeUpdateForExistingJob(existing);
    await prisma.job.update({ where: { id: existing.id }, data });
    await prisma.jobEvent.create({
      data: {
        jobId: existing.id,
        type: "PROLINE_UPSERT",
        source: "proline",
        payload: {
          ...(e.raw as object),
          invoiceDeltaSkippedDuplicate,
        },
      },
    });
    if (invoiceDeltaApplied && e.invoiceId) {
      await prisma.jobEvent.create({
        data: {
          jobId: existing.id,
          type: invoiceDeltaMarkerType(e.invoiceId),
          source: "proline",
          payload: {
            invoiceId: e.invoiceId,
            invoiceNumber: e.invoiceNumber ?? null,
            invoicedDelta: e.invoicedDelta ?? null,
          },
        },
      });
    }
    await ensureRequiredNameWriteback(existing, e.name);
    await recalculateJobAndCommissions(existing.id);
    return NextResponse.json({ ok: true, jobId: existing.id, upsert: "updated" });
  }

  const existing = await prisma.job.findFirst({
    where: { prolineJobId: e.prolineJobId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Job not found for prolineJobId" }, { status: 404 });
  }

  const { data, invoiceDeltaApplied, invoiceDeltaSkippedDuplicate } = await computeUpdateForExistingJob(existing);

  await prisma.job.update({ where: { id: existing.id }, data });
  await prisma.jobEvent.create({
    data: {
      jobId: existing.id,
      type: "PROLINE_" + e.internalType.toUpperCase().replace(/\./g, "_"),
      source: "proline",
      payload: {
        ...(e.raw as object),
        invoiceDeltaSkippedDuplicate,
      },
    },
  });
  if (invoiceDeltaApplied && e.invoiceId) {
    await prisma.jobEvent.create({
      data: {
        jobId: existing.id,
        type: invoiceDeltaMarkerType(e.invoiceId),
        source: "proline",
        payload: {
          invoiceId: e.invoiceId,
          invoiceNumber: e.invoiceNumber ?? null,
          invoicedDelta: e.invoicedDelta ?? null,
        },
      },
    });
  }
  await recalculateJobAndCommissions(existing.id);
  return NextResponse.json({ ok: true, jobId: existing.id, invoiceDeltaSkippedDuplicate });
}
