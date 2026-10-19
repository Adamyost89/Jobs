import { type PrismaClient, Prisma } from "@prisma/client";
import {
  hasProlinePartnerKeys,
  prolinePartnerListAll,
  readProlinePartnerEnv,
} from "@/lib/proline-partner-client";
import {
  normalizePartnerInvoice,
  normalizePartnerPayment,
  type NormalizedPartnerInvoice,
  type NormalizedPartnerPayment,
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
  /** Also page invoices (slower; +1 call / 5s per page). Default true. */
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
};

function partnerPaymentEventType(paymentId: string): string {
  const safe = String(paymentId)
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, "_")
    .slice(0, 120);
  return `${PARTNER_PAYMENT_EVENT_PREFIX}${safe || "UNKNOWN"}`;
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

export async function reconcileProlinePaymentsFromPartnerApi(
  db: PrismaClient,
  opts: PartnerPaymentReconcileOpts
): Promise<PartnerPaymentReconcileResult> {
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
  };

  if (!result.partnerConfigured) {
    result.errors.push("Partner API keys not configured (PROLINE_PARTNER_KEY + PROLINE_COMPANY_KEY).");
    return result;
  }

  const env = readProlinePartnerEnv();
  const tolerance = opts.tolerance ?? 0.005;
  const maxPages = opts.maxPages ?? 100;
  const includeInvoices = opts.includeInvoices !== false;

  const paymentsByProject = new Map<string, NormalizedPartnerPayment[]>();
  try {
    for await (const page of prolinePartnerListAll(env, "/v1/list/payments", {
      maxPages,
      createdAfter: opts.createdAfter,
      createdBefore: opts.createdBefore,
    })) {
      for (const row of page.results) {
        result.paymentsSeen += 1;
        const p = normalizePartnerPayment(row);
        if (!p) continue;
        if (!p.projectId) {
          result.unmatchedPayments += 1;
          continue;
        }
        const list = paymentsByProject.get(p.projectId) ?? [];
        list.push(p);
        paymentsByProject.set(p.projectId, list);
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
        }
      }
    } catch (e) {
      result.errors.push(`Invoices: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const projectIds = [...new Set([...paymentsByProject.keys(), ...invoicesByProject.keys()])];
  if (!projectIds.length) return result;

  const jobs = await db.job.findMany({
    where: { prolineJobId: { in: projectIds } },
    select: {
      id: true,
      jobNumber: true,
      prolineJobId: true,
      amountPaid: true,
      invoicedTotal: true,
      paidInFull: true,
    },
  });
  const jobByProline = new Map(jobs.map((j) => [j.prolineJobId!, j]));

  for (const projectId of projectIds) {
    const job = jobByProline.get(projectId);
    if (!job || !job.prolineJobId) {
      const orphanPays = paymentsByProject.get(projectId)?.length ?? 0;
      result.unmatchedPayments += orphanPays;
      continue;
    }
    result.matchedJobs += 1;

    const pays = paymentsByProject.get(projectId) ?? [];
    const invs = invoicesByProject.get(projectId) ?? [];

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

    // Always try to backfill dated payment events when applying (even if totals already match).
    let eventsToWrite = 0;
    if (opts.apply && pays.length) {
      for (const p of pays) {
        const type = partnerPaymentEventType(p.paymentId);
        const existing = await db.jobEvent.findFirst({
          where: { jobId: job.id, type },
          select: { id: true },
        });
        if (existing) continue;
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
              projectId,
              invoiceId: p.invoiceId,
              status: p.status,
              method: p.method,
              createdAt: at.toISOString(),
            },
          },
        });
        eventsToWrite += 1;
      }
      result.paymentEventsWritten += eventsToWrite;
    }

    if (!changed.length && eventsToWrite === 0) continue;

    if (changed.length) {
      result.mismatches += 1;
      if (result.samples.length < 100) {
        result.samples.push({
          jobId: job.id,
          jobNumber: job.jobNumber,
          prolineJobId: job.prolineJobId,
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

    if (changed.length) {
      const data: Record<string, unknown> = {};
      if (changed.includes("amountPaid") && remoteAmountPaid !== undefined) {
        data.amountPaid = new Prisma.Decimal(remoteAmountPaid.toFixed(2));
      }
      if (changed.includes("invoicedTotal") && remoteInvoiced !== undefined) {
        data.invoicedTotal = new Prisma.Decimal(remoteInvoiced.toFixed(2));
        data.invoiceFlag = true;
      }
      if (changed.includes("paidInFull") && remotePaidInFull !== undefined) {
        data.paidInFull = remotePaidInFull;
      }
      await db.job.update({ where: { id: job.id }, data });
      await db.jobEvent.create({
        data: {
          jobId: job.id,
          type: PARTNER_RECONCILE_EVENT,
          source: "proline_partner",
          payload: {
            changed,
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

    const paymentFieldsChanged = changed.includes("amountPaid") || changed.includes("paidInFull") || eventsToWrite > 0;
    await recalculateJobAndCommissions(job.id, {
      forceCommissionRecalc: paymentFieldsChanged || changed.length > 0,
      forceCommissionRecalcReason: "proline.partner.payment_reconcile",
    });
    result.updated += 1;
  }

  return result;
}
