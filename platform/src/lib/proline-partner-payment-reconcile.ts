import { type PrismaClient, Prisma } from "@prisma/client";
import {
  hasProlinePartnerKeys,
  prolinePartnerListAll,
  readProlinePartnerEnv,
} from "@/lib/proline-partner-client";
import {
  normalizePartnerInvoice,
  normalizePartnerPayment,
  normalizePartnerProject,
  type NormalizedPartnerInvoice,
  type NormalizedPartnerPayment,
  type NormalizedPartnerProject,
} from "@/lib/proline-partner-normalize";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";

/** Dated per-payment marker; cutovers treat these like PROLINE_PAYMENT_DELTA_*. */
export const PARTNER_PAYMENT_EVENT_PREFIX = "PROLINE_PARTNER_PAYMENT_";
export const PARTNER_RECONCILE_EVENT = "PROLINE_PARTNER_RECONCILE";

export type PartnerPaymentReconcileOpts = {
  apply: boolean;
  maxPages?: number;
  createdAfter?: string | null;
  createdBefore?: string | null;
  tolerance?: number;
  /** Also page invoices (slower; +1 call / 5s per page). Default false. */
  includeInvoices?: boolean;
};

export type PartnerPaymentMismatch = {
  jobId: string;
  jobNumber: string;
  prolineJobId: string;
  fields: string[];
  local: {
    amountPaid: number | null;
    invoicedTotal: number;
    paidInFull: boolean;
  };
  remote: {
    amountPaid?: number;
    invoicedTotal?: number;
    paidInFull?: boolean;
    paymentCount?: number;
  };
};

export type PartnerPaymentReconcileResult = {
  paymentsSeen: number;
  invoicesSeen: number;
  matchedJobs: number;
  unmatchedPayments: number;
  paymentEventsWritten: number;
  mismatches: number;
  updated: number;
  errors: string[];
  samples: PartnerPaymentMismatch[];
  partnerConfigured: boolean;
  /** Why matching failed / how ids look (especially useful on dry-run). */
  diagnostics: {
    paymentsWithProjectId: number;
    paymentsWithoutProjectId: number;
    paymentsNormalizedFailed: number;
    distinctPartnerProjectIds: number;
    localJobsWithProlineId: number;
    samplePartnerProjectIds: string[];
    samplePartnerPaymentKeys: string[];
    samplePartnerProjectKeys: string[];
    sampleLocalProlineIds: string[];
    partnerProjectsLoaded: number;
    matchedBy: {
      prolineJobId: number;
      leadNumber: number;
      projectAlias: number;
    };
  };
};

type JobRow = {
  id: string;
  jobNumber: string;
  prolineJobId: string | null;
  leadNumber: string | null;
  amountPaid: Prisma.Decimal | null;
  invoicedTotal: Prisma.Decimal;
  paidInFull: boolean;
};

export function partnerPaymentEventType(paymentId: string): string {
  const safe = String(paymentId)
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, "_")
    .slice(0, 120);
  return `${PARTNER_PAYMENT_EVENT_PREFIX}${safe || "UNKNOWN"}`;
}

/** Webhook dedupe marker — same payment_id must not also add via Partner. */
export function webhookPaymentDeltaEventType(paymentId: string): string {
  const safe = String(paymentId)
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, "_")
    .slice(0, 120);
  return `PROLINE_PAYMENT_DELTA_${safe || "UNKNOWN"}`;
}

function partnerPaymentCountsTowardPaid(p: NormalizedPartnerPayment): boolean {
  const s = (p.status || "").toLowerCase();
  if (!s) return true;
  return !/(fail|refus|void|cancel|decline|refund|charge\s*back|chargedback|rejected)/i.test(s);
}

function approxEqual(a: number | null | undefined, b: number | null | undefined, tolerance = 0.005): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tolerance;
}

function paymentEffectiveAt(p: NormalizedPartnerPayment): Date {
  return p.paidAt ?? p.createdAt ?? new Date();
}

function invoiceLooksPaid(inv: NormalizedPartnerInvoice): boolean {
  if (inv.balance != null && inv.balance <= 0.0005) return true;
  const s = (inv.status || "").toLowerCase();
  return s.includes("paid") || s === "complete" || s === "closed";
}

function emptyDiagnostics(): PartnerPaymentReconcileResult["diagnostics"] {
  return {
    paymentsWithProjectId: 0,
    paymentsWithoutProjectId: 0,
    paymentsNormalizedFailed: 0,
    distinctPartnerProjectIds: 0,
    localJobsWithProlineId: 0,
    samplePartnerProjectIds: [],
    samplePartnerPaymentKeys: [],
    samplePartnerProjectKeys: [],
    sampleLocalProlineIds: [],
    partnerProjectsLoaded: 0,
    matchedBy: { prolineJobId: 0, leadNumber: 0, projectAlias: 0 },
  };
}

/** Index Partner projects by every known id + project number so Bubble legacy ids still resolve. */
function buildPartnerProjectIndex(projects: NormalizedPartnerProject[]): {
  byAnyId: Map<string, NormalizedPartnerProject>;
  byNumber: Map<string, NormalizedPartnerProject>;
} {
  const byAnyId = new Map<string, NormalizedPartnerProject>();
  const byNumber = new Map<string, NormalizedPartnerProject>();
  for (const p of projects) {
    for (const id of p.aliasIds) byAnyId.set(id, p);
    if (p.projectNumber) byNumber.set(p.projectNumber, p);
  }
  return { byAnyId, byNumber };
}

export async function reconcileProlinePaymentsFromPartnerApi(
  db: PrismaClient,
  opts: PartnerPaymentReconcileOpts
): Promise<PartnerPaymentReconcileResult> {
  const diagnostics = emptyDiagnostics();
  const result: PartnerPaymentReconcileResult = {
    paymentsSeen: 0,
    invoicesSeen: 0,
    matchedJobs: 0,
    unmatchedPayments: 0,
    paymentEventsWritten: 0,
    mismatches: 0,
    updated: 0,
    errors: [],
    samples: [],
    partnerConfigured: hasProlinePartnerKeys(),
    diagnostics,
  };

  if (!result.partnerConfigured) {
    result.errors.push("Partner API keys not configured (PROLINE_PARTNER_KEY + PROLINE_COMPANY_KEY).");
    return result;
  }

  const env = readProlinePartnerEnv();
  const tolerance = opts.tolerance ?? 0.005;
  const maxPages = opts.maxPages ?? 100;
  const includeInvoices = opts.includeInvoices === true;

  const allPayments: NormalizedPartnerPayment[] = [];
  try {
    for await (const page of prolinePartnerListAll(env, "/v1/list/payments", {
      maxPages,
      createdAfter: opts.createdAfter,
      createdBefore: opts.createdBefore,
    })) {
      for (const row of page.results) {
        result.paymentsSeen += 1;
        if (
          diagnostics.samplePartnerPaymentKeys.length === 0 &&
          row &&
          typeof row === "object" &&
          !Array.isArray(row)
        ) {
          diagnostics.samplePartnerPaymentKeys = Object.keys(row as object).slice(0, 40);
        }
        const p = normalizePartnerPayment(row);
        if (!p) {
          diagnostics.paymentsNormalizedFailed += 1;
          result.unmatchedPayments += 1;
          continue;
        }
        if (!p.projectId && !p.projectNumber) {
          diagnostics.paymentsWithoutProjectId += 1;
          result.unmatchedPayments += 1;
          continue;
        }
        if (p.projectId) diagnostics.paymentsWithProjectId += 1;
        else diagnostics.paymentsWithoutProjectId += 1;
        allPayments.push(p);
        if (p.projectId && diagnostics.samplePartnerProjectIds.length < 8) {
          if (!diagnostics.samplePartnerProjectIds.includes(p.projectId)) {
            diagnostics.samplePartnerProjectIds.push(p.projectId);
          }
        }
      }
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
    return result;
  }

  const invoicesByProject = new Map<string, NormalizedPartnerInvoice[]>();
  if (includeInvoices) {
    try {
      for await (const page of prolinePartnerListAll(env, "/v1/list/invoices", {
        maxPages,
        createdAfter: opts.createdAfter,
        createdBefore: opts.createdBefore,
      })) {
        for (const row of page.results) {
          result.invoicesSeen += 1;
          const inv = normalizePartnerInvoice(row);
          if (!inv?.projectId) continue;
          const list = invoicesByProject.get(inv.projectId) ?? [];
          list.push(inv);
          invoicesByProject.set(inv.projectId, list);
          if (diagnostics.samplePartnerProjectIds.length < 8) {
            if (!diagnostics.samplePartnerProjectIds.includes(inv.projectId)) {
              diagnostics.samplePartnerProjectIds.push(inv.projectId);
            }
          }
        }
      }
    } catch (e) {
      result.errors.push(`Invoices: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const partnerProjectIds = [
    ...new Set([
      ...allPayments.map((p) => p.projectId).filter((id): id is string => !!id),
      ...invoicesByProject.keys(),
    ]),
  ];
  diagnostics.distinctPartnerProjectIds = partnerProjectIds.length;

  // Load Partner projects so new ids (vs…) can resolve to legacy Bubble ids / project numbers.
  // Stop early once every payment_project_id has been seen (list is newest-first, so this often finishes
  // well before scanning the whole company — important under ~1 call / 5s rate limits / HTTP timeouts).
  const neededProjectIds = new Set(partnerProjectIds);
  const partnerProjects: NormalizedPartnerProject[] = [];
  try {
    for await (const page of prolinePartnerListAll(env, "/v1/list/projects", {
      maxPages: Math.min(Math.max(maxPages, 60), 120),
    })) {
      for (const row of page.results) {
        if (
          diagnostics.samplePartnerProjectKeys.length === 0 &&
          row &&
          typeof row === "object" &&
          !Array.isArray(row)
        ) {
          diagnostics.samplePartnerProjectKeys = Object.keys(row as object).slice(0, 40);
        }
        const proj = normalizePartnerProject(row);
        if (!proj) continue;
        partnerProjects.push(proj);
        for (const alias of proj.aliasIds) neededProjectIds.delete(alias);
      }
      if (neededProjectIds.size === 0) break;
    }
    if (neededProjectIds.size > 0) {
      result.errors.push(
        `Project alias map incomplete: ${neededProjectIds.size} payment project id(s) not found in listed projects (rate-limit page cap). Re-run or use CLI npm run proline:partner-reconcile for a deeper scan.`
      );
    }
  } catch (e) {
    result.errors.push(`Projects: ${e instanceof Error ? e.message : String(e)}`);
  }
  diagnostics.partnerProjectsLoaded = partnerProjects.length;
  const projectIndex = buildPartnerProjectIndex(partnerProjects);

  const partnerLeadNumbers = [
    ...new Set([
      ...allPayments.map((p) => p.projectNumber).filter((n): n is string => !!n),
      ...partnerProjects.map((p) => p.projectNumber).filter((n): n is string => !!n),
    ]),
  ];

  const allAliasIds = [
    ...new Set([...partnerProjectIds, ...partnerProjects.flatMap((p) => p.aliasIds)]),
  ];

  const localWithProline = await db.job.findMany({
    where: { prolineJobId: { not: null } },
    select: { prolineJobId: true },
    take: 20,
  });
  diagnostics.localJobsWithProlineId = await db.job.count({ where: { prolineJobId: { not: null } } });
  diagnostics.sampleLocalProlineIds = localWithProline
    .map((j) => j.prolineJobId)
    .filter((id): id is string => !!id)
    .slice(0, 8);

  if (!partnerProjectIds.length && !partnerLeadNumbers.length && !allAliasIds.length) {
    result.errors.push(
      "Partner payments/invoices had no recognizable project_id or project_number. Check samplePartnerPaymentKeys in diagnostics."
    );
    return result;
  }

  // Load local jobs that can match: any with a ProLine id (Bubble legacy or new), plus lead# hits.
  // Partner payment_project_id is often the new `vs…` id while Job.prolineJobId is still Bubble `…x…`.
  const jobs = await db.job.findMany({
    where: {
      OR: [
        { prolineJobId: { not: null } },
        ...(partnerLeadNumbers.length ? [{ leadNumber: { in: partnerLeadNumbers } }] : []),
      ],
    },
    select: {
      id: true,
      jobNumber: true,
      prolineJobId: true,
      leadNumber: true,
      amountPaid: true,
      invoicedTotal: true,
      paidInFull: true,
    },
  });

  const jobByProline = new Map<string, JobRow>();
  const jobByLead = new Map<string, JobRow>();
  for (const j of jobs) {
    if (j.prolineJobId) jobByProline.set(j.prolineJobId, j);
    if (j.leadNumber) jobByLead.set(j.leadNumber, j);
  }

  function resolveJobForPartnerProjectId(
    projectId: string | null,
    projectNumber: string | null
  ): { job: JobRow; via: "prolineJobId" | "leadNumber" | "projectAlias" } | null {
    if (projectId && jobByProline.has(projectId)) {
      return { job: jobByProline.get(projectId)!, via: "prolineJobId" };
    }
    const partnerProj =
      (projectId ? projectIndex.byAnyId.get(projectId) : undefined) ??
      (projectNumber ? projectIndex.byNumber.get(projectNumber) : undefined);
    if (partnerProj) {
      for (const alias of partnerProj.aliasIds) {
        if (jobByProline.has(alias)) {
          return { job: jobByProline.get(alias)!, via: "projectAlias" };
        }
      }
      if (partnerProj.projectNumber && jobByLead.has(partnerProj.projectNumber)) {
        return { job: jobByLead.get(partnerProj.projectNumber)!, via: "leadNumber" };
      }
      // Known Partner project but no local job — do not fall through to bare payment_project_number
      // (that was attaching foreign payments onto jobs and inflating amountPaid).
      return null;
    }
    // No projectId / project not in index: lead# only when payment has no project id.
    if (!projectId && projectNumber && jobByLead.has(projectNumber)) {
      return { job: jobByLead.get(projectNumber)!, via: "leadNumber" };
    }
    return null;
  }

  /** Group payments onto a matched job id. */
  const paymentsByJobId = new Map<string, NormalizedPartnerPayment[]>();
  const jobById = new Map<string, JobRow>();

  for (const p of allPayments) {
    if (!partnerPaymentCountsTowardPaid(p)) {
      result.unmatchedPayments += 1;
      continue;
    }
    const resolved = resolveJobForPartnerProjectId(p.projectId, p.projectNumber);
    if (!resolved) {
      result.unmatchedPayments += 1;
      continue;
    }
    diagnostics.matchedBy[resolved.via] += 1;
    jobById.set(resolved.job.id, resolved.job);
    const list = paymentsByJobId.get(resolved.job.id) ?? [];
    list.push(p);
    paymentsByJobId.set(resolved.job.id, list);
  }

  const invoicesByJobId = new Map<string, NormalizedPartnerInvoice[]>();
  for (const [projectId, invs] of invoicesByProject) {
    const resolved = resolveJobForPartnerProjectId(projectId, null);
    if (!resolved) continue;
    jobById.set(resolved.job.id, resolved.job);
    const existing = invoicesByJobId.get(resolved.job.id) ?? [];
    existing.push(...invs);
    invoicesByJobId.set(resolved.job.id, existing);
  }

  const jobIds = [...new Set([...paymentsByJobId.keys(), ...invoicesByJobId.keys()])];
  result.matchedJobs = jobIds.length;

  for (const jobId of jobIds) {
    const job = jobById.get(jobId);
    if (!job) continue;

    const pays = paymentsByJobId.get(jobId) ?? [];
    const invs = invoicesByJobId.get(jobId) ?? [];

    const paidFromPayments = pays.reduce((s, p) => s + p.amount, 0);
    const paidFromInvoices = invs.reduce((s, i) => s + (i.amountPaid ?? 0), 0);
    const invoicedFromInvoices = invs.reduce((s, i) => s + (i.total ?? 0), 0);

    const remoteAmountPaid =
      pays.length > 0 ? Math.max(0, paidFromPayments) : paidFromInvoices > 0 ? Math.max(0, paidFromInvoices) : undefined;
    const remoteInvoiced =
      invoicedFromInvoices > 0.0005
        ? Math.max(0, invoicedFromInvoices)
        : remoteAmountPaid !== undefined
          ? Math.max(job.invoicedTotal.toNumber(), remoteAmountPaid)
          : undefined;
    const remotePaidInFull =
      invs.length > 0
        ? invs.every(invoiceLooksPaid)
        : remoteAmountPaid !== undefined &&
            job.invoicedTotal.toNumber() > 0.0005 &&
            remoteAmountPaid + 0.005 >= job.invoicedTotal.toNumber()
          ? true
          : undefined;

    const localAmountPaid = job.amountPaid ? job.amountPaid.toNumber() : null;
    const localInvoiced = job.invoicedTotal.toNumber();

    const changed: string[] = [];
    if (remoteAmountPaid !== undefined && !approxEqual(localAmountPaid, remoteAmountPaid, tolerance)) {
      changed.push("amountPaid");
    }
    if (remoteInvoiced !== undefined && !approxEqual(localInvoiced, remoteInvoiced, tolerance)) {
      changed.push("invoicedTotal");
    }
    if (remotePaidInFull !== undefined && job.paidInFull !== remotePaidInFull) {
      changed.push("paidInFull");
    }

    let eventsToWrite = 0;
    if (opts.apply && pays.length) {
      for (const p of pays) {
        const type = partnerPaymentEventType(p.paymentId);
        const alreadyPartner = await db.jobEvent.findFirst({
          where: { jobId: job.id, type },
          select: { id: true },
        });
        if (alreadyPartner) continue;
        const at = paymentEffectiveAt(p);
        await db.jobEvent.create({
          data: {
            jobId: job.id,
            type,
            source: "proline_partner",
            createdAt: at,
            payload: {
              paymentId: p.paymentId,
              paymentDelta: p.amount,
              amount: p.amount,
              projectId: p.projectId,
              projectNumber: p.projectNumber,
              invoiceId: p.invoiceId,
              status: p.status,
              method: p.method,
              createdAt: at.toISOString(),
              // Webhook may already have PROLINE_PAYMENT_DELTA_* for this id; amountPaid is
              // overwritten from Partner sum (not added again).
              webhookDeltaType: webhookPaymentDeltaEventType(p.paymentId),
            },
          },
        });
        eventsToWrite += 1;
      }
      result.paymentEventsWritten += eventsToWrite;
    }

    // Partner payment sum is authoritative for amountPaid whenever we matched payments.
    if (pays.length && remoteAmountPaid !== undefined && !approxEqual(localAmountPaid, remoteAmountPaid, tolerance)) {
      if (!changed.includes("amountPaid")) changed.push("amountPaid");
    }

    if (!changed.length && eventsToWrite === 0) {
      continue;
    }

    if (changed.length) {
      result.mismatches += 1;
      if (result.samples.length < 100) {
        result.samples.push({
          jobId: job.id,
          jobNumber: job.jobNumber,
          prolineJobId: job.prolineJobId ?? "",
          fields: changed,
          local: {
            amountPaid: localAmountPaid,
            invoicedTotal: localInvoiced,
            paidInFull: job.paidInFull,
          },
          remote: {
            amountPaid: remoteAmountPaid,
            invoicedTotal: remoteInvoiced,
            paidInFull: remotePaidInFull,
            paymentCount: pays.length,
          },
        });
      }
    }

    if (!opts.apply) continue;

    if (changed.length || (pays.length > 0 && remoteAmountPaid !== undefined)) {
      const data: Record<string, unknown> = {};
      // Always trust Partner payment sum when we have matched payments (fixes webhook double-count).
      if (pays.length > 0 && remoteAmountPaid !== undefined) {
        data.amountPaid = new Prisma.Decimal(remoteAmountPaid.toFixed(2));
      } else if (changed.includes("amountPaid") && remoteAmountPaid !== undefined) {
        data.amountPaid = new Prisma.Decimal(remoteAmountPaid.toFixed(2));
      }
      if (changed.includes("invoicedTotal") && remoteInvoiced !== undefined) {
        data.invoicedTotal = new Prisma.Decimal(remoteInvoiced.toFixed(2));
        data.invoiceFlag = true;
      }
      if (changed.includes("paidInFull") && remotePaidInFull !== undefined) {
        data.paidInFull = remotePaidInFull;
      }
      if (Object.keys(data).length) {
        await db.job.update({ where: { id: job.id }, data });
        await db.jobEvent.create({
          data: {
            jobId: job.id,
            type: PARTNER_RECONCILE_EVENT,
            source: "proline_partner",
            payload: {
              changed: changed.length ? changed : ["amountPaid"],
              local: {
                amountPaid: localAmountPaid,
                invoicedTotal: localInvoiced,
                paidInFull: job.paidInFull,
              },
              remote: {
                amountPaid: remoteAmountPaid ?? null,
                invoicedTotal: remoteInvoiced ?? null,
                paidInFull: remotePaidInFull ?? null,
                paymentCount: pays.length,
              },
            },
          },
        });
      }
    }

    const paymentFieldsChanged = changed.includes("amountPaid") || changed.includes("paidInFull") || eventsToWrite > 0;
    await recalculateJobAndCommissions(job.id, {
      forceCommissionRecalc: paymentFieldsChanged || changed.length > 0 || pays.length > 0,
      forceCommissionRecalcReason: "proline.partner.payment_reconcile",
    });
    result.updated += 1;
  }

  return result;
}
