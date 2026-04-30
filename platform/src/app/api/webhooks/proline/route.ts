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
  const cfgRows = await prisma.$queryRaw<Array<{ prolineNameAliases: unknown }>>(
    Prisma.sql`SELECT "prolineNameAliases" FROM "SystemConfig" WHERE "id" = 'singleton' LIMIT 1`
  );
  const normalized = normalizeProlineWebhookBody(json, {
    PROLINE_USER_MAP: process.env.PROLINE_USER_MAP,
    PROLINE_NAME_ALIASES: cfgRows[0]?.prolineNameAliases,
  });

  if (!normalized.ok) {
    const err = normalized.error;
    const message = typeof err === "string" ? err : "Invalid payload";
    const details = typeof err === "string" ? undefined : err.flatten();
    return NextResponse.json({ error: message, details }, { status: 400 });
  }

  const e = normalized.event;
  const year = e.year ?? new Date().getFullYear();

  function buildProlineEventPayload(extra?: Record<string, unknown>): Prisma.InputJsonObject {
    const rawObject =
      e.raw && typeof e.raw === "object" && !Array.isArray(e.raw) ? (e.raw as Record<string, unknown>) : {};
    return {
      ...rawObject,
      quoteId: e.quoteId ?? null,
      quoteName: e.quoteName ?? null,
      shareLink: e.shareLink ?? null,
      approvedDate: e.approvedDate ?? null,
      approvedTotal: e.approvedTotal ?? e.contractAmount ?? null,
      ...(extra ?? {}),
    } as Prisma.InputJsonObject;
  }

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

  function isClosedLifecycleStatus(raw: string | undefined): boolean {
    if (!raw) return false;
    const s = raw.trim().toLowerCase();
    return s.includes("complete") || s.includes("closed");
  }

  function skipProlineCreate(): boolean {
    const incoming = incomingLifecycleFromEvent();
    if (incoming === undefined) return true;
    return !isAllowedProlineLifecycleStatus(incoming);
  }

  function skipProlineUpdate(existing: { status: string }): boolean {
    // Financial webhooks can carry payment/invoice statuses (e.g. Paid/Failed)
    // that are unrelated to project lifecycle and must not block recording.
    if (e.internalType === "invoice" || e.internalType === "payment") return false;
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
    contractAmount: Prisma.Decimal;
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
          contractAmount: true,
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
          contractAmount: true,
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
      // Name writeback is best-effort and must never block financial recalculation.
      console.error("ProLine name writeback failed:", error);
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
      if (isClosedLifecycleStatus(incoming)) {
        data.paidInFull = true;
        if (e.paidDate === undefined) data.paidDate = new Date();
      }
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
    const closedLifecycle = isClosedLifecycleStatus(incomingLifecycleFromEvent());
    if (e.paidInFull !== undefined && !closedLifecycle) data.paidInFull = e.paidInFull;
    if (closedLifecycle) data.paidInFull = true;
    if (e.paidDate !== undefined) data.paidDate = e.paidDate ? new Date(e.paidDate) : null;

    if (e.salespersonName) {
      const sp = await resolveOrCreateSalespersonByName(prisma, e.salespersonName, {
        preferFirstToken: false,
      });
      if (sp?.id) data.salesperson = { connect: { id: sp.id } };
    }

    let invoiceDeltaApplied = false;
    let invoiceDeltaSkippedDuplicate = false;
    // Only invoice events should grow invoiced total. Payment events may include the same
    // invoice total in payload; applying it again would double-count invoiced dollars.
    if (e.internalType === "invoice" && e.invoicedDelta !== undefined && e.invoicedDelta !== 0) {
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
          contractAmount: Prisma.Decimal;
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
    const closedLifecycle = isClosedLifecycleStatus(lifecycle);
    const jobNumber = await allocateNextJobNumber(year);
    let salespersonId: string | null = null;
    if (e.salespersonName) {
      const sp = await resolveOrCreateSalespersonByName(prisma, e.salespersonName, {
        preferFirstToken: false,
      });
      salespersonId = sp?.id ?? null;
    }
    const contract = new Prisma.Decimal((e.contractAmount ?? 0).toFixed(2));
    const signedAtNow = new Date();
    const job = await prisma.job.create({
      data: {
        jobNumber,
        year,
        leadNumber: e.leadNumber ?? null,
        name: e.name ?? null,
        contractSignedAt: signedAtNow,
        contractAmount: contract,
        projectRevenue: contract,
        cost: asDecimal(Math.max(0, e.cost ?? 0)),
        amountPaid: e.amountPaid !== undefined ? asDecimal(Math.max(0, e.amountPaid)) : null,
        salespersonId,
        prolineJobId: e.prolineJobId,
        status: normalizeStatus(lifecycle),
        prolineStage: e.prolineStage ?? null,
        paidInFull: closedLifecycle ? true : (e.paidInFull ?? false),
        paidDate: e.paidDate ? new Date(e.paidDate) : (closedLifecycle ? new Date() : null),
      },
    });
    await prisma.jobEvent.create({
      data: {
        jobId: job.id,
        type: "PROLINE_SIGNED",
        source: "proline",
        payload: buildProlineEventPayload(),
      },
    });
    const paymentFieldsPresent = e.amountPaid !== undefined || e.paidInFull !== undefined || e.paidDate !== undefined;
    await recalculateJobAndCommissions(job.id, {
      forceCommissionRecalc: paymentFieldsPresent,
      forceCommissionRecalcReason: "proline.webhook.create.payment_fields_present",
    });
    await ensureRequiredNameWriteback(job, e.name);
    return { kind: "created" as const, job };
  }

  function isQuoteApprovedWebhook(): boolean {
    if (e.internalType !== "job.updated") return false;
    const raw = e.raw;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const body = raw as Record<string, unknown>;
    const trigger = typeof body.trigger === "string" ? body.trigger.trim().toLowerCase() : "";
    return (
      trigger.includes("quote") ||
      body.quote_id !== undefined ||
      body.quote_name !== undefined ||
      body.approved_total !== undefined ||
      body.approved_date !== undefined
    );
  }

  function approvedDateFromEvent(): Date | null {
    if (!e.approvedDate) return null;
    const t = String(e.approvedDate).trim();
    if (!t) return null;
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  function approvedAmountFromEvent(): Prisma.Decimal {
    return asDecimal(Math.max(0, e.approvedTotal ?? e.contractAmount ?? 0));
  }

  async function createQuoteApprovedJob(approvedDate: Date): Promise<{ id: string; jobNumber: string }> {
    const jobNumber = await allocateNextJobNumber(year);
    let salespersonId: string | null = null;
    if (e.salespersonName) {
      const sp = await resolveOrCreateSalespersonByName(prisma, e.salespersonName, {
        preferFirstToken: false,
      });
      salespersonId = sp?.id ?? null;
    }
    const contract = approvedAmountFromEvent();
    const statusRaw = incomingLifecycleFromEvent();
    const closedLifecycle = isClosedLifecycleStatus(statusRaw);
    const job = await prisma.job.create({
      data: {
        jobNumber,
        year,
        leadNumber: e.leadNumber ?? null,
        name: e.name ?? null,
        contractSignedAt: approvedDate,
        contractAmount: contract,
        projectRevenue: contract,
        cost: asDecimal(Math.max(0, e.cost ?? 0)),
        amountPaid: e.amountPaid !== undefined ? asDecimal(Math.max(0, e.amountPaid)) : null,
        salespersonId,
        prolineJobId: e.prolineJobId,
        status: normalizeStatus(statusRaw ?? "UNKNOWN"),
        prolineStage: e.prolineStage ?? null,
        paidInFull: closedLifecycle ? true : (e.paidInFull ?? false),
        paidDate: e.paidDate ? new Date(e.paidDate) : (closedLifecycle ? new Date() : null),
      },
    });
    await prisma.jobEvent.create({
      data: {
        jobId: job.id,
        type: "PROLINE_QUOTE_APPROVED",
        source: "proline",
        payload: buildProlineEventPayload(),
      },
    });
    const paymentFieldsPresent = e.amountPaid !== undefined || e.paidInFull !== undefined || e.paidDate !== undefined;
    await recalculateJobAndCommissions(job.id, {
      forceCommissionRecalc: paymentFieldsPresent,
      forceCommissionRecalcReason: "proline.webhook.quote_approved.create.payment_fields_present",
    });
    await ensureRequiredNameWriteback(job, e.name);
    return job;
  }

  if (isQuoteApprovedWebhook()) {
    const existing = await findExistingJobForWebhook();
    const approvedDate = approvedDateFromEvent();
    if (!approvedDate) {
      return NextResponse.json({
        ok: true,
        skipped: "quote_not_approved_yet",
        message: "Quote webhook received without approved_date; no job created or contract update applied.",
      });
    }

    if (!existing) {
      const job = await createQuoteApprovedJob(approvedDate);
      return NextResponse.json({
        ok: true,
        jobId: job.id,
        jobNumber: job.jobNumber,
        quoteApproved: "created",
      });
    }

    const nextContractAmount = existing.contractAmount.plus(approvedAmountFromEvent());
    const data: Prisma.JobUpdateInput = {
      contractAmount: nextContractAmount,
      projectRevenue: nextContractAmount,
    };
    const closedLifecycle = isClosedLifecycleStatus(incomingLifecycleFromEvent());
    if (e.name !== undefined) data.name = e.name;
    if (e.prolineJobId) data.prolineJobId = e.prolineJobId;
    if (e.leadNumber !== undefined) {
      const incomingLead = e.leadNumber?.trim() || null;
      const existingLead = existing.leadNumber?.trim() || null;
      if (!existingLead || existingLead === incomingLead) {
        data.leadNumber = incomingLead;
      } else if (incomingLead && existingLead !== incomingLead) {
        logProlineWebhook("lead_conflict_preserve_existing", {
          jobId: existing.id,
          existingLead,
          incomingLead,
        });
      }
    }
    if (e.prolineStage !== undefined) {
      const s = e.prolineStage == null ? "" : String(e.prolineStage).trim();
      data.prolineStage = s === "" ? null : s;
    }
    if (closedLifecycle) {
      data.paidInFull = true;
      if (e.paidDate === undefined) data.paidDate = new Date();
    } else {
      if (e.paidInFull !== undefined) data.paidInFull = e.paidInFull;
      if (e.paidDate !== undefined) data.paidDate = e.paidDate ? new Date(e.paidDate) : null;
    }
    if (e.salespersonName) {
      const sp = await resolveOrCreateSalespersonByName(prisma, e.salespersonName, {
        preferFirstToken: false,
      });
      if (sp?.id) data.salesperson = { connect: { id: sp.id } };
    }

    await prisma.job.update({ where: { id: existing.id }, data });
    await prisma.jobEvent.create({
      data: {
        jobId: existing.id,
        type: "PROLINE_QUOTE_APPROVED",
        source: "proline",
        payload: buildProlineEventPayload(),
      },
    });
    const paymentFieldsPresent = e.amountPaid !== undefined || e.paidInFull !== undefined || e.paidDate !== undefined;
    await recalculateJobAndCommissions(existing.id, {
      forceCommissionRecalc: paymentFieldsPresent,
      forceCommissionRecalcReason: "proline.webhook.quote_approved.update.payment_fields_present",
    });
    await ensureRequiredNameWriteback(existing, e.name);
    return NextResponse.json({
      ok: true,
      jobId: existing.id,
      jobNumber: existing.jobNumber,
      quoteApproved: "updated_existing",
    });
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
        payload: buildProlineEventPayload({ invoiceDeltaSkippedDuplicate }),
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
    const paymentFieldsChanged =
      Object.prototype.hasOwnProperty.call(data, "amountPaid") ||
      Object.prototype.hasOwnProperty.call(data, "paidInFull") ||
      Object.prototype.hasOwnProperty.call(data, "paidDate");
    await recalculateJobAndCommissions(existing.id, {
      forceCommissionRecalc: paymentFieldsChanged,
      forceCommissionRecalcReason: "proline.webhook.upsert.update.payment_fields_changed",
    });
    await ensureRequiredNameWriteback(existing, e.name);
    return NextResponse.json({ ok: true, jobId: existing.id, jobNumber: existing.jobNumber, upsert: "updated" });
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
      payload: buildProlineEventPayload({ invoiceDeltaSkippedDuplicate }),
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
  const paymentFieldsChanged =
    Object.prototype.hasOwnProperty.call(data, "amountPaid") ||
    Object.prototype.hasOwnProperty.call(data, "paidInFull") ||
    Object.prototype.hasOwnProperty.call(data, "paidDate");
  await recalculateJobAndCommissions(existing.id, {
    forceCommissionRecalc: paymentFieldsChanged,
    forceCommissionRecalcReason: "proline.webhook.typed_update.payment_fields_changed",
  });
  return NextResponse.json({
    ok: true,
    jobId: existing.id,
    jobNumber: existing.jobNumber,
    invoiceDeltaSkippedDuplicate,
  });
}
