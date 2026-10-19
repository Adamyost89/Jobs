import { randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";
import {
  reconcileProlinePaymentsFromPartnerApi,
  type PartnerPaymentReconcileOpts,
  type PartnerPaymentReconcileResult,
} from "@/lib/proline-partner-payment-reconcile";

export type PartnerReconcileJobStatus = "running" | "done" | "error";

export type PartnerReconcileJob = {
  id: string;
  status: PartnerReconcileJobStatus;
  apply: boolean;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  result?: PartnerPaymentReconcileResult;
};

/** Single-process store (one Docker app container). Survives Cloudflare 100s cutoffs. */
const jobs = new Map<string, PartnerReconcileJob>();
let activeRunId: string | null = null;

const MAX_KEPT = 20;

function prune() {
  if (jobs.size <= MAX_KEPT) return;
  const sorted = [...jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const j of sorted.slice(0, jobs.size - MAX_KEPT)) {
    if (j.status !== "running") jobs.delete(j.id);
  }
}

export function getPartnerReconcileJob(id: string): PartnerReconcileJob | null {
  return jobs.get(id) ?? null;
}

export function getActivePartnerReconcileJob(): PartnerReconcileJob | null {
  if (!activeRunId) return null;
  return jobs.get(activeRunId) ?? null;
}

export function startPartnerReconcileJob(
  db: PrismaClient,
  opts: PartnerPaymentReconcileOpts,
  audit?: { userId: string }
): PartnerReconcileJob {
  const existing = getActivePartnerReconcileJob();
  if (existing?.status === "running") {
    return existing;
  }

  const id = randomUUID();
  const job: PartnerReconcileJob = {
    id,
    status: "running",
    apply: opts.apply === true,
    startedAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  activeRunId = id;
  prune();

  void (async () => {
    try {
      const result = await reconcileProlinePaymentsFromPartnerApi(db, opts);
      const done: PartnerReconcileJob = {
        ...job,
        status: "done",
        finishedAt: new Date().toISOString(),
        result,
      };
      jobs.set(id, done);
      if (activeRunId === id) activeRunId = null;

      if (audit?.userId) {
        try {
          await db.auditLog.create({
            data: {
              userId: audit.userId,
              action: opts.apply
                ? "PROLINE_PARTNER_PAYMENT_RECONCILE_APPLY"
                : "PROLINE_PARTNER_PAYMENT_RECONCILE_DRY",
              entityType: "Job",
              entityId: "bulk",
              payload: {
                runId: id,
                paymentsSeen: result.paymentsSeen,
                matchedJobs: result.matchedJobs,
                updated: result.updated,
                paymentEventsWritten: result.paymentEventsWritten,
                unmatchedPayments: result.unmatchedPayments,
                mismatches: result.mismatches,
              },
            },
          });
        } catch {
          // non-fatal
        }
      }
    } catch (e) {
      const failed: PartnerReconcileJob = {
        ...job,
        status: "error",
        finishedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      };
      jobs.set(id, failed);
      if (activeRunId === id) activeRunId = null;
    }
  })();

  return job;
}
