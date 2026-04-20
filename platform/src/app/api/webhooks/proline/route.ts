import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { allocateNextJobNumber, recalculateJobAndCommissions } from "@/lib/job-workflow";
import { normalizeProlineWebhookBody } from "@/lib/proline-webhook";
import {
  buildProlineProjectNameForAssignedJob,
  sendProlineNameWritebackViaZapier,
} from "@/lib/proline-name-writeback";
import { resolveOrCreateSalespersonByName } from "@/lib/salesperson-name";
import {
  isAllowedProlineLifecycleStatus,
  jobQualifiesForProlineAutomation,
} from "@/lib/proline-lifecycle-status";
import { normalizeStatus } from "@/lib/status";

function asDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n.toFixed(2));
}

function invoiceDeltaMarkerType(invoiceId: string): string {
  const safe = String(invoiceId)
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, "_")
    .slice(0, 120);
  return `PROLINE_INVOICE_DELTA_${safe || "UNKNOWN"}`;
}

function prolineWebhookDebugEnabled(): boolean {
  const v = (process.env.PROLINE_WEBHOOK_DEBUG || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function logProlineWebhook(message: string, data: Record<string, unknown>) {
  if (!prolineWebhookDebugEnabled()) return;
  console.log(
    JSON.stringify({
      tag: "proline_webhook",
      ts: new Date().toISOString(),
      message,
      ...data,
    })
  );
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

  logProlineWebhook("received", {
    internalType: e.internalType,
    prolineJobId: e.prolineJobId,
    leadNumber: e.leadNumber ?? null,
    status: e.status ?? null,
    prolineStage: e.prolineStage ?? null,
    hasContract: e.contractAmount !== undefined,
    hasCost: e.cost !== undefined,
  });

  function incomingLifecycleFromEvent(): string | undefined {
    if (e.status === undefined || e.status === null) return undefined;
    const t = String(e.status).trim();
    return t === "" ? undefined : t;
  }

  function skipProlineCreate(): boolean {
    const incoming = incomingLifecycleFromEvent();
    if (incoming === undefined) return true;
    return !isAllowedProlineLifecycleStatus(incoming);
  }

  function skipProlineUpdate(existing: { status: string }): boolean {
    const incoming = incomingLifecycleFromEvent();
    if (incoming !== undefined && !isAllowedProlineLifecycleStatus(incoming)) return true;
    if (incoming === undefined && !jobQualifiesForProlineAutomation(existing.status)) return true;
    return false;
  }

  async function findExistingJobForWebhook(): Promise<{
    id: string;
    jobNumber: string;
    leadNumber: string | null;
    prolineJobId: string | null;
    status: string;
    invoicedTotal: Prisma.Decimal;
    amountPaid: Prisma.Decimal | null;
  } | null> {
    const leadNorm = e.leadNumber?.trim() || null;
    const pid = e.prolineJobId?.trim() || null;

    // 1) ProLine project_number (leadNumber) is the primary identifier for jobs.
    if (leadNorm) {
      const leadRows = await prisma.job.findMany({
        where: {
          OR: [
            { leadNumber: leadNorm },
            { leadNumber: { equals: leadNorm, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          jobNumber: true,
          leadNumber: true,
          prolineJobId: true,
          status: true,
          invoicedTotal: true,
          amountPaid: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 50,
      });
      if (!leadRows.length) {
        logProlineWebhook("no_match_by_lead", { leadNumber: leadNorm });
      } else {
        if (pid) {
          const both = leadRows.find((r) => r.prolineJobId === pid);
          if (both) {
            logProlineWebhook("match_lead_and_id", { jobId: both.id, jobNumber: both.jobNumber });
            return both;
          }
        }
        const chosen = leadRows[0] ?? null;
        if (chosen && leadRows.length > 1) {
          logProlineWebhook("match_lead_ambiguous", {
            leadNumber: leadNorm,
            chosenJobNumber: chosen.jobNumber,
            candidateCount: leadRows.length,
          });
        } else if (chosen) {
          logProlineWebhook("match_by_lead", { jobId: chosen.id, jobNumber: chosen.jobNumber });
        }
        return chosen;
      }
    }

    // 2) Fallback to project_id if there is no usable leadNumber match.
    if (pid) {
      const byId = await prisma.job.findFirst({
        where: { prolineJobId: pid },
        select: {
          id: true,
          jobNumber: true,
          leadNumber: true,
          prolineJobId: true,
          status: true,
          invoicedTotal: true,
          amountPaid: true,
          updatedAt: true,
        },
      });
      if (byId) {
        logProlineWebhook("match_by_proline_job_id_fallback", {
          jobId: byId.id,
          jobNumber: byId.jobNumber,
          leadNumber: byId.leadNumber,
        });
        return byId;
      }
    }

    logProlineWebhook("no_match_no_lead", { prolineJobId: pid });
    return null;
  }

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
    leadNumber: string | null;
    status: string;
    invoicedTotal: Prisma.Decimal;
    amountPaid: Prisma.Decimal | null;
  }): Promise<{
    data: Prisma.JobUpdateInput;
    invoiceDeltaApplied: boolean;
    invoiceDeltaSkippedDuplicate: boolean;
  }> {
    const data: Prisma.JobUpdateInput = {};
    if (e.name !== undefined) data.name = e.name;
    if (e.leadNumber !== undefined) {
      const incomingLead = e.leadNumber?.trim() || null;
      const existingLead = existing.leadNumber?.trim() || null;
      if (!existingLead || existingLead === incomingLead) {
        data.leadNumber = incomingLead;
      } else if (incomingLead && existingLead !== incomingLead) {
        // Guardrail: do not silently overwrite a different existing lead number.
        logProlineWebhook("lead_conflict_preserve_existing", {
          jobId: existing.id,
          existingLead,
          incomingLead,
        });
      }
    }
    if (e.prolineJobId) data.prolineJobId = e.prolineJobId;
    if (e.contractAmount !== undefined) {
      const c = asDecimal(e.contractAmount);
      data.contractAmount = c;
      data.projectRevenue = c;
    }
    {
      const incoming = incomingLifecycleFromEvent();
      if (incoming !== undefined) data.status = normalizeStatus(incoming);
    }
    if (e.prolineStage !== undefined) {
      const s = e.prolineStage == null ? "" : String(e.prolineStage).trim();
      data.prolineStage = s === "" ? null : s;
    }
    if (e.cost !== undefined) data.cost = asDecimal(e.cost);
    if (e.amountPaid !== undefined) {
      const paid = Math.max(0, e.amountPaid);
      data.amountPaid = asDecimal(paid);
    }
    if (e.paidInFull !== undefined) data.paidInFull = e.paidInFull;
    if (e.paidDate !== undefined) data.paidDate = e.paidDate ? new Date(e.paidDate) : null;

    if (e.salespersonName) {
      const sp = await resolveOrCreateSalespersonByName(prisma, e.salespersonName, {
        preferFirstToken: true,
      });
      if (sp?.id) data.salesperson = { connect: { id: sp.id } };
    }

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

  async function createJob(): Promise<
    | { kind: "created"; job: { id: string; jobNumber: string } }
    | {
        kind: "dedupe";
        job: {
          id: string;
          jobNumber: string;
          leadNumber: string | null;
          prolineJobId: string | null;
          status: string;
          invoicedTotal: Prisma.Decimal;
          amountPaid: Prisma.Decimal | null;
        };
      }
    | { kind: "skipped_status" }
  > {
    const dup = await findExistingJobForWebhook();
    if (dup) {
      return { kind: "dedupe" as const, job: dup };
    }
    if (skipProlineCreate()) {
      logProlineWebhook("skip_create_lifecycle_status", {
        prolineJobId: e.prolineJobId,
        incomingStatus: incomingLifecycleFromEvent() ?? null,
      });
      return { kind: "skipped_status" as const };
    }
    const lifecycle = incomingLifecycleFromEvent();
    if (!lifecycle) {
      return { kind: "skipped_status" as const };
    }
    const jobNumber = await allocateNextJobNumber(year);
    let salespersonId: string | null = null;
    if (e.salespersonName) {
      const sp = await resolveOrCreateSalespersonByName(prisma, e.salespersonName, {
        preferFirstToken: true,
      });
      salespersonId = sp?.id ?? null;
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
        status: normalizeStatus(lifecycle),
        prolineStage: e.prolineStage ?? null,
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
    if (r.kind === "skipped_status") {
      return NextResponse.json({
        ok: true,
        skipped: "proline_lifecycle_status",
        message:
          "Job create skipped: ProLine job status must be Open, Won, Complete, or Closed. Pipeline stage is not used.",
      });
    }
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
    const existing = await findExistingJobForWebhook();
    if (!existing) {
      const r = await createJob();
      if (r.kind === "skipped_status") {
        return NextResponse.json({
          ok: true,
          skipped: "proline_lifecycle_status",
          upsert: "skipped_create",
          message:
            "Job create skipped: ProLine job status must be Open, Won, Complete, or Closed. Pipeline stage is not used.",
        });
      }
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
    if (skipProlineUpdate(existing)) {
      logProlineWebhook("skip_upsert_update_lifecycle_status", {
        jobId: existing.id,
        jobNumber: existing.jobNumber,
        incomingStatus: incomingLifecycleFromEvent() ?? null,
        existingStatus: existing.status,
      });
      return NextResponse.json({
        ok: true,
        skipped: "proline_lifecycle_status",
        jobId: existing.id,
        upsert: "skipped_update",
        message:
          "Job update skipped: requires Open/Won/Complete/Closed (or an existing job already in that lifecycle).",
      });
    }
    const { data, invoiceDeltaApplied, invoiceDeltaSkippedDuplicate } = await computeUpdateForExistingJob(existing);
    logProlineWebhook("upsert_update", {
      jobId: existing.id,
      jobNumber: existing.jobNumber,
      patchKeys: Object.keys(data),
    });
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

  const existing = await findExistingJobForWebhook();
  if (!existing) {
    logProlineWebhook("not_found", {
      internalType: e.internalType,
      prolineJobId: e.prolineJobId,
      leadNumber: e.leadNumber ?? null,
    });
    return NextResponse.json(
      { error: "Job not found for project_id or project_number (leadNumber)" },
      { status: 404 }
    );
  }

  if (skipProlineUpdate(existing)) {
    logProlineWebhook("skip_typed_update_lifecycle_status", {
      internalType: e.internalType,
      jobId: existing.id,
      incomingStatus: incomingLifecycleFromEvent() ?? null,
      existingStatus: existing.status,
    });
    return NextResponse.json({
      ok: true,
      skipped: "proline_lifecycle_status",
      jobId: existing.id,
      message:
        "Update skipped: requires Open/Won/Complete/Closed (or an existing job already in that lifecycle).",
    });
  }

  const { data, invoiceDeltaApplied, invoiceDeltaSkippedDuplicate } = await computeUpdateForExistingJob(existing);

  logProlineWebhook("typed_update", {
    internalType: e.internalType,
    jobId: existing.id,
    jobNumber: existing.jobNumber,
    patchKeys: Object.keys(data),
  });
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
