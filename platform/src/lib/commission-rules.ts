/**
 * Commission owed per job from `CommissionPlan` + per-rep YTD tier totals.
 * Lead # (`jobIdNum` / parsed `leadNumber`) matches Job Numbering sheet logic.
 */

import type {
  CommissionPersonRuleV1,
  CommissionPlanConfigV1,
  CommissionRunningTierPack,
  CommissionTierTotals,
} from "./commission-plan-types";
import type { SalesKind } from "./salespeople-kind-db";

export type CommissionRowCalc = {
  salespersonName: string;
  owed: number;
  paid: number;
  overrideSkip: boolean;
};

export type CommissionComputeContext = {
  year: number;
  leadNumber: string | null;
  jobIdNum: number;
  /** Full commission basis (usually project revenue) for the job. */
  basis: number;
  /** Amount customer has paid so far. */
  customerPaid: number;
  /** Revenue target used to measure payment progress. */
  commissionableTotal: number;
  /** Explicit settlement signal from source systems. */
  paidInFull: boolean;
  primarySalespersonName: string | null;
  drewParticipation: string | null;
  existingPaidBySalesperson: Record<string, number>;
  overrides: Record<string, boolean>;
  plan: CommissionPlanConfigV1;
  tierTotals: CommissionTierTotals;
  kindBySalespersonName: Record<string, SalesKind>;
  /** Inactive reps/managers are skipped entirely (no new commission rows). */
  activeBySalespersonName: Record<string, boolean>;
  /** Names that already have a commission row on this job (used to zero-out inactive without dropping history). */
  existingCommissionNamesOnJob: Set<string>;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function owedAfterPaid(totalCommission: number, paid: number) {
  const v = totalCommission - paid;
  return v < 0 ? 0 : round2(v);
}

function leadNumFromCtx(ctx: CommissionComputeContext) {
  return parseInt(String(ctx.leadNumber || ""), 10) || 0;
}

/** Job sheet / API: when this is explicitly “no”, Drew is omitted for this job (same row can recalc without re-adding him). */
export function isDrewParticipationExplicitlyOff(drewParticipation: string | null): boolean {
  if (drewParticipation == null) return false;
  const t = String(drewParticipation).trim().toLowerCase();
  if (!t) return false;
  const negatives = new Set([
    "no",
    "n",
    "false",
    "0",
    "none",
    "n/a",
    "na",
    "-",
    "—",
    "no drew",
    "x",
    "no participation",
  ]);
  return negatives.has(t);
}

function rateFromLeadBrackets(
  leadNum: number,
  brackets: { minLead: number; rate: number }[] | undefined,
  baseRate: number | undefined
): number {
  if (brackets?.length) {
    const sorted = [...brackets].sort((a, b) => b.minLead - a.minLead);
    for (const b of sorted) {
      if (leadNum >= b.minLead) return b.rate;
    }
  }
  return baseRate ?? 0;
}

function rateFromRunningTiers(
  pack: CommissionRunningTierPack,
  jobIdNum: number,
  totals: { ytdPaid: number; ytdPrimaryBasis: number }
): number {
  const running = pack.metric === "ytd_paid_commissions" ? totals.ytdPaid : totals.ytdPrimaryBasis;
  const sorted = [...pack.tiers].sort((a, b) => b.minTotal - a.minTotal);
  for (const t of sorted) {
    if (running >= t.minTotal) return t.rate;
  }
  const br = pack.belowRates;
  if (br?.byLead) {
    return jobIdNum < br.byLead.splitLead ? br.byLead.belowRate : br.byLead.atOrAboveRate;
  }
  if (br?.flat !== undefined) return br.flat;
  return 0;
}

function resolvePersonRate(rule: CommissionPersonRuleV1, ctx: CommissionComputeContext, salespersonName: string): number {
  const totals = ctx.tierTotals[salespersonName] ?? { ytdPaid: 0, ytdPrimaryBasis: 0 };
  if (rule.runningTiers) {
    return rateFromRunningTiers(rule.runningTiers, ctx.jobIdNum, totals);
  }
  if (rule.leadBrackets?.length) {
    return rateFromLeadBrackets(leadNumFromCtx(ctx), rule.leadBrackets, rule.baseRate);
  }
  return rule.baseRate ?? 0;
}

function scopeFromLeadBrackets(
  leadNum: number,
  brackets: { minLead: number; scope: "all_jobs" | "primary_only" }[] | undefined,
  baseScope: "all_jobs" | "primary_only"
) {
  if (brackets?.length) {
    const sorted = [...brackets].sort((a, b) => b.minLead - a.minLead);
    for (const b of sorted) {
      if (leadNum >= b.minLead) return b.scope;
    }
  }
  return baseScope;
}

function effectiveScope(rule: CommissionPersonRuleV1, kind: SalesKind | undefined, leadNum: number) {
  const scoped = scopeFromLeadBrackets(leadNum, rule.scopeByLead, rule.scope);
  if (kind === "MANAGER" && !rule.scopeByLead?.length) return "all_jobs" as const;
  return scoped;
}

function shouldIncludePerson(
  salespersonName: string,
  rule: CommissionPersonRuleV1,
  ctx: CommissionComputeContext
): boolean {
  const kind = ctx.kindBySalespersonName[salespersonName];
  const scope = effectiveScope(rule, kind, leadNumFromCtx(ctx));
  if (scope === "all_jobs") return true;
  return ctx.primarySalespersonName === salespersonName;
}

function orderedPeopleNames(plan: CommissionPlanConfigV1): string[] {
  if (plan.peopleOrder?.length) {
    return plan.peopleOrder.filter((n) => plan.people[n]);
  }
  return Object.keys(plan.people).sort();
}

function applyElevatedPaidGuard(
  rule: CommissionPersonRuleV1,
  rate: number,
  ctx: CommissionComputeContext,
  salespersonName: string,
  paid: number
): { oweZero: boolean } {
  const g = rule.elevatedPaidGuard;
  if (!g || rate !== g.elevatedRate) return { oweZero: false };
  const legacy = ctx.jobIdNum < g.splitLead ? g.belowRate : g.elseRate;
  if (paid >= legacy * ctx.basis - 0.01) return { oweZero: true };
  return { oweZero: false };
}

export function computeCommissionsForJob(ctx: CommissionComputeContext): CommissionRowCalc[] {
  const out: CommissionRowCalc[] = [];
  const paid = Math.max(0, ctx.customerPaid);
  const invoiceBase = Math.max(0, ctx.commissionableTotal);
  const paymentProgress =
    ctx.paidInFull === true ? 1 : invoiceBase > 0.0005 ? clamp01(paid / invoiceBase) : 0;

  for (const sp of orderedPeopleNames(ctx.plan)) {
    const rule = ctx.plan.people[sp];
    if (!rule) continue;

    if (sp === "Drew" && isDrewParticipationExplicitlyOff(ctx.drewParticipation)) {
      continue;
    }

    if (ctx.activeBySalespersonName[sp] === false) {
      if (!ctx.existingCommissionNamesOnJob.has(sp)) continue;
      if (ctx.overrides[sp]) {
        out.push({
          salespersonName: sp,
          owed: 0,
          paid: ctx.existingPaidBySalesperson[sp] ?? 0,
          overrideSkip: true,
        });
        continue;
      }
      const paid = ctx.existingPaidBySalesperson[sp] ?? 0;
      out.push({ salespersonName: sp, owed: 0, paid, overrideSkip: false });
      continue;
    }

    if (ctx.overrides[sp]) {
      out.push({
        salespersonName: sp,
        owed: 0,
        paid: ctx.existingPaidBySalesperson[sp] ?? 0,
        overrideSkip: true,
      });
      continue;
    }

    if (!shouldIncludePerson(sp, rule, ctx)) {
      continue;
    }

    const paidCommission = ctx.existingPaidBySalesperson[sp] ?? 0;
    const rate = resolvePersonRate(rule, ctx, sp);
    const totalCommission = ctx.basis * rate;
    const earnedToDate = totalCommission * paymentProgress;

    const guard = applyElevatedPaidGuard(rule, rate, ctx, sp, paidCommission);
    if (guard.oweZero) {
      out.push({ salespersonName: sp, owed: 0, paid: paidCommission, overrideSkip: false });
      continue;
    }

    out.push({
      salespersonName: sp,
      owed: owedAfterPaid(earnedToDate, paidCommission),
      paid: paidCommission,
      overrideSkip: false,
    });
  }

  const byName = new Map(out.map((r) => [r.salespersonName, r]));
  return Array.from(byName.values());
}
