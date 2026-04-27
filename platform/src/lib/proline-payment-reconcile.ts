import { type PrismaClient } from "@prisma/client";
import { extractProjectListPage, prolineApiGet, readProlineApiEnv } from "@/lib/proline-api-client";
import { pickProlineProjectIdFromRecord } from "@/lib/proline-webhook";
import { recalculateJobAndCommissions } from "@/lib/job-workflow";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function flattenRecord(raw: unknown): Record<string, unknown> {
  const r = asRecord(raw);
  if (!r) return {};
  const inner = asRecord(r.project);
  if (inner) return { ...r, ...inner };
  return r;
}

function pickStr(r: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickMoney(r: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = parseFloat(v.replace(/[$,]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickDate(r: Record<string, unknown>, keys: string[]): Date | undefined {
  const s = pickStr(r, keys);
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function approxEqual(a: number | null | undefined, b: number | null | undefined, tolerance = 0.005): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tolerance;
}

function remotePaidInFull(flat: Record<string, unknown>): boolean | undefined {
  const amountDue = pickMoney(flat, ["amount_due", "balance_due", "balance"]);
  if (amountDue !== undefined) return amountDue <= 0.0005;
  const status = (pickStr(flat, ["invoice_status", "status", "payment_status"]) || "").toLowerCase();
  if (!status) return undefined;
  if (status.includes("paid in full") || status === "paid") return true;
  if (status.includes("partial") || status.includes("failed") || status.includes("due")) return false;
  return undefined;
}

function remoteAmountPaid(flat: Record<string, unknown>): number | undefined {
  const explicit = pickMoney(flat, ["amount_paid", "amountPaid", "previous_payments", "paid_amount"]);
  if (explicit !== undefined) return Math.max(0, explicit);
  const total = pickMoney(flat, ["total", "invoice_total", "invoiced_total"]);
  const amountDue = pickMoney(flat, ["amount_due", "balance_due", "balance"]);
  if (total !== undefined && amountDue !== undefined) return Math.max(0, total - amountDue);
  return undefined;
}

function remoteInvoicedTotal(flat: Record<string, unknown>): number | undefined {
  const total = pickMoney(flat, ["total", "invoice_total", "invoiced_total", "invoicedTotal"]);
  if (total === undefined) return undefined;
  return Math.max(0, total);
}

export type ReconcileProlinePaymentsOpts = {
  maxPages: number;
  apply: boolean;
  tolerance?: number;
};

export type PaymentMismatch = {
  jobId: string;
  jobNumber: string;
  prolineJobId: string;
  fields: string[];
  local: {
    amountPaid: number | null;
    invoicedTotal: number;
    paidInFull: boolean;
    paidDate: string | null;
  };
  remote: {
    amountPaid?: number;
    invoicedTotal?: number;
    paidInFull?: boolean;
    paidDate?: string;
  };
};

export type ReconcileProlinePaymentsResult = {
  pagesFetched: number;
  rowsSeen: number;
  matchedJobs: number;
  missingLocalJobs: number;
  mismatches: number;
  updated: number;
  errors: string[];
  samples: PaymentMismatch[];
  lastStatus?: number;
  lastUrl?: string;
};

export async function reconcileProlinePaymentsFromApi(
  db: PrismaClient,
  opts: ReconcileProlinePaymentsOpts
): Promise<ReconcileProlinePaymentsResult> {
  const env = readProlineApiEnv();
  const tolerance = opts.tolerance ?? 0.005;
  const result: ReconcileProlinePaymentsResult = {
    pagesFetched: 0,
    rowsSeen: 0,
    matchedJobs: 0,
    missingLocalJobs: 0,
    mismatches: 0,
    updated: 0,
    errors: [],
    samples: [],
  };

  let query: Record<string, string> = {};
  for (let page = 0; page < opts.maxPages; page++) {
    let res: Awaited<ReturnType<typeof prolineApiGet>>;
    try {
      res = await prolineApiGet(env, query);
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
    result.lastStatus = res.status;
    result.lastUrl = res.url;
    if (res.status < 200 || res.status >= 300) {
      const hint =
        typeof res.json === "object" && res.json !== null
          ? JSON.stringify(res.json).slice(0, 400)
          : String(res.json);
      result.errors.push(`HTTP ${res.status} from ProLine: ${hint}`);
      break;
    }

    const { items, nextQuery } = extractProjectListPage(res.json, query);
    result.pagesFetched += 1;
    result.rowsSeen += items.length;

    for (const raw of items) {
      const flat = flattenRecord(raw);
      const prolineJobId = pickProlineProjectIdFromRecord(flat);
      if (!prolineJobId) continue;

      const local = await db.job.findFirst({
        where: { prolineJobId },
        select: {
          id: true,
          jobNumber: true,
          amountPaid: true,
          invoicedTotal: true,
          paidInFull: true,
          paidDate: true,
        },
      });
      if (!local) {
        result.missingLocalJobs += 1;
        continue;
      }
      result.matchedJobs += 1;

      const remotePaid = remoteAmountPaid(flat);
      const remoteInvoiced = remoteInvoicedTotal(flat);
      const remotePif = remotePaidInFull(flat);
      const remoteDate = pickDate(flat, ["paid_date", "payment_date", "paidDate"]);

      const localAmountPaid = local.amountPaid ? local.amountPaid.toNumber() : null;
      const localInvoiced = local.invoicedTotal.toNumber();
      const localDateIso = local.paidDate ? local.paidDate.toISOString() : null;
      const remoteDateIso = remoteDate ? remoteDate.toISOString() : undefined;

      const changed: string[] = [];
      if (remotePaid !== undefined && !approxEqual(localAmountPaid, remotePaid, tolerance)) changed.push("amountPaid");
      if (remoteInvoiced !== undefined && !approxEqual(localInvoiced, remoteInvoiced, tolerance)) changed.push("invoicedTotal");
      if (remotePif !== undefined && local.paidInFull !== remotePif) changed.push("paidInFull");
      if (remoteDateIso !== undefined && localDateIso !== remoteDateIso) changed.push("paidDate");
      if (!changed.length) continue;

      result.mismatches += 1;
      if (result.samples.length < 100) {
        result.samples.push({
          jobId: local.id,
          jobNumber: local.jobNumber,
          prolineJobId,
          fields: changed,
          local: {
            amountPaid: localAmountPaid,
            invoicedTotal: localInvoiced,
            paidInFull: local.paidInFull,
            paidDate: localDateIso,
          },
          remote: {
            amountPaid: remotePaid,
            invoicedTotal: remoteInvoiced,
            paidInFull: remotePif,
            paidDate: remoteDateIso,
          },
        });
      }

      if (!opts.apply) continue;

      const data: Record<string, unknown> = {};
      if (changed.includes("amountPaid") && remotePaid !== undefined) data.amountPaid = remotePaid;
      if (changed.includes("invoicedTotal") && remoteInvoiced !== undefined) data.invoicedTotal = remoteInvoiced;
      if (changed.includes("paidInFull") && remotePif !== undefined) data.paidInFull = remotePif;
      if (changed.includes("paidDate")) data.paidDate = remoteDate ?? null;

      await db.job.update({ where: { id: local.id }, data });
      await db.jobEvent.create({
        data: {
          jobId: local.id,
          type: "PROLINE_PAYMENT_RECONCILE",
          source: "proline_api",
          payload: {
            prolineJobId,
            changed,
            local: {
              amountPaid: localAmountPaid,
              invoicedTotal: localInvoiced,
              paidInFull: local.paidInFull,
              paidDate: localDateIso,
            },
            remote: {
              amountPaid: remotePaid ?? null,
              invoicedTotal: remoteInvoiced ?? null,
              paidInFull: remotePif ?? null,
              paidDate: remoteDateIso ?? null,
            },
          },
        },
      });
      const paymentFieldsChanged =
        changed.includes("amountPaid") || changed.includes("paidInFull") || changed.includes("paidDate");
      await recalculateJobAndCommissions(local.id, {
        forceCommissionRecalc: paymentFieldsChanged,
        forceCommissionRecalcReason: "proline.payment_reconcile.changed_payment_fields",
      });
      result.updated += 1;
    }

    if (!nextQuery || items.length === 0) break;
    query = nextQuery;
  }

  return result;
}
