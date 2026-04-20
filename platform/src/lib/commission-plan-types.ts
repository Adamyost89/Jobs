/**
 * Stored in `CommissionPlan.config` (JSON). Lead # (`Job.leadNumber`) is used for bracket math,
 * matching the Job Numbering sheet and `recalculateJobAndCommissions`.
 */

export const COMMISSION_PLAN_VERSION = 1 as const;

/** Who receives a commission row for a given job. */
export type CommissionScope = "all_jobs" | "primary_only";

/**
 * - `ytd_paid_commissions`: sum of this rep's `Commission.paidAmount` for the job year (sheet H-style running total).
 * - `ytd_primary_job_basis`: sum of commission basis on jobs where this rep is primary salesperson (sold revenue).
 */
export type CommissionRunningMetric = "ytd_paid_commissions" | "ytd_primary_job_basis";

export type CommissionRunningTierPack = {
  metric: CommissionRunningMetric;
  /** Descending `minTotal` is easiest to reason about; resolver picks first where runningTotal >= minTotal. */
  tiers: { minTotal: number; rate: number }[];
  /** When no tier matches (running total below all thresholds). */
  belowRates?: {
    flat?: number;
    byLead?: { splitLead: number; belowRate: number; atOrAboveRate: number };
  };
};

/** When an elevated tier rate applies, match legacy Sheets behavior: no new owed if already fully paid at pre-elevated rates. */
export type ElevatedPaidGuard = {
  elevatedRate: number;
  splitLead: number;
  belowRate: number;
  elseRate: number;
};

export type CommissionPersonRuleV1 = {
  scope: CommissionScope;
  /** Optional lead-based scope override; first match wins by descending `minLead`. */
  scopeByLead?: { minLead: number; scope: CommissionScope }[];
  /** Optional static rate when no `leadBrackets` / `runningTiers`. */
  baseRate?: number;
  /** First match wins scanning in descending `minLead` order. */
  leadBrackets?: { minLead: number; rate: number }[];
  runningTiers?: CommissionRunningTierPack;
  elevatedPaidGuard?: ElevatedPaidGuard;
};

export type CommissionPlanConfigV1 = {
  version: typeof COMMISSION_PLAN_VERSION;
  /** Optional stable ordering for UI / deterministic upserts. */
  peopleOrder?: string[];
  people: Record<string, CommissionPersonRuleV1>;
};

export type CommissionTierTotals = Record<
  string,
  {
    ytdPaid: number;
    ytdPrimaryBasis: number;
  }
>;

export function isCommissionPlanConfigV1(v: unknown): v is CommissionPlanConfigV1 {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.version !== COMMISSION_PLAN_VERSION) return false;
  if (!o.people || typeof o.people !== "object") return false;
  for (const rule of Object.values(o.people as Record<string, unknown>)) {
    if (!rule || typeof rule !== "object") return false;
    const r = rule as Record<string, unknown>;
    if (r.scope !== "all_jobs" && r.scope !== "primary_only") return false;
  }
  return true;
}
