import {
  COMMISSION_PLAN_VERSION,
  isCommissionPlanConfigV1,
  type CommissionPlanConfigV1,
} from "./commission-plan-types";

/** Spreadsheet-parity defaults (Job Numbering / Apps Script). */
export function defaultCommissionPlanConfig(year: number): CommissionPlanConfigV1 {
  if (year === 2024 || year === 2025) {
    return {
      version: COMMISSION_PLAN_VERSION,
      peopleOrder: ["Brett", "Drew", "James", "Geoff", "Will"],
      people: {
        Brett: { scope: "all_jobs", baseRate: 0.05 },
        Will: { scope: "all_jobs", baseRate: 0.05 },
        Drew: {
          scope: "primary_only",
          scopeByLead: [
            { minLead: 1858, scope: "all_jobs" },
            { minLead: 0, scope: "primary_only" },
          ],
          leadBrackets: [
            { minLead: 1858, rate: 0.01 },
            { minLead: 0, rate: 0.05 },
          ],
        },
        James: {
          scope: "all_jobs",
          runningTiers: {
            metric: "ytd_paid_commissions",
            tiers: [{ minTotal: 1_000_000, rate: 0.105 }],
            belowRates: {
              byLead: { splitLead: 1203, belowRate: 0.04, atOrAboveRate: 0.1 },
            },
          },
          elevatedPaidGuard: {
            elevatedRate: 0.105,
            splitLead: 1203,
            belowRate: 0.04,
            elseRate: 0.1,
          },
        },
        Geoff: {
          scope: "all_jobs",
          leadBrackets: [{ minLead: 1750, rate: 0.05 }],
          baseRate: 0,
        },
      },
    };
  }
  if (year === 2026) {
    return {
      version: COMMISSION_PLAN_VERSION,
      peopleOrder: ["Brett", "Drew", "James", "Mike"],
      people: {
        Brett: { scope: "all_jobs", baseRate: 0.05 },
        Mike: { scope: "all_jobs", baseRate: 0.05 },
        Drew: { scope: "all_jobs", baseRate: 0.01 },
        James: {
          scope: "all_jobs",
          runningTiers: {
            metric: "ytd_paid_commissions",
            tiers: [{ minTotal: 1_000_000, rate: 0.105 }],
            belowRates: { flat: 0.1 },
          },
        },
      },
    };
  }
  return {
    version: COMMISSION_PLAN_VERSION,
    peopleOrder: [],
    people: {},
  };
}

/** Saved DB row wins when valid; otherwise fall back to built-in defaults for the job year. */
export function commissionPlanForJobYear(year: number, stored: unknown | null | undefined): CommissionPlanConfigV1 {
  if (stored && isCommissionPlanConfigV1(stored)) return stored;
  return defaultCommissionPlanConfig(year);
}
