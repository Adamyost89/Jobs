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

export type CommissionRowExplain = {
  salespersonName: string;
  included: boolean;
  reason: string;
  scope: "all_jobs" | "primary_only";
  kind: SalesKind | "UNKNOWN";
  active: boolean;
  override: boolean;
  rate: number;
  rateReason: string;
  basis: number;
  customerPaid: number;
  commissionableTotal: number;
  paymentProgress: number;
  totalCommissionAtRate: number;
  earnedToDate: number;
  alreadyPaidCommission: number;
  elevatedPaidGuard: {
    enabled: boolean;
    triggered: boolean;
    legacyRate: number;
    legacyCommission: number;
  };
  owed: number;
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
  /** Explicit settlement signal from source systems (kept for auditing/UI, not payout progression). */
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

function resolvePersonRateDetail(
  rule: CommissionPersonRuleV1,
  ctx: CommissionComputeContext,
  salespersonName: string
): { rate: number; reason: string } {
  const totals = ctx.tierTotals[salespersonName] ?? { ytdPaid: 0, ytdPrimaryBasis: 0 };
  if (rule.runningTiers) {
    const pack = rule.runningTiers;
    const running = pack.metric === "ytd_paid_commissions" ? totals.ytdPaid : totals.ytdPrimaryBasis;
    const sorted = [...pack.tiers].sort((a, b) => b.minTotal - a.minTotal);
    for (const t of sorted) {
      if (running >= t.minTotal) {
        return {
          rate: t.rate,
          reason: `running tier met: ${pack.metric}=${round2(running)} >= ${round2(t.minTotal)}`,
        };
      }
    }
    const br = pack.belowRates;
    if (br?.byLead) {
      const rate = ctx.jobIdNum < br.byLead.splitLead ? br.byLead.belowRate : br.byLead.atOrAboveRate;
      return {
        rate,
        reason: `running tier below threshold; fallback by lead split at ${br.byLead.splitLead}`,
      };
    }
    if (br?.flat !== undefined) {
      return {
        rate: br.flat,
        reason: `running tier below threshold; fallback flat rate`,
      };
    }
    return { rate: 0, reason: "running tier configured with no fallback rate" };
  }
  if (rule.leadBrackets?.length) {
    const lead = leadNumFromCtx(ctx);
    const sorted = [...rule.leadBrackets].sort((a, b) => b.minLead - a.minLead);
    for (const b of sorted) {
      if (lead >= b.minLead) {
        return { rate: b.rate, reason: `lead bracket matched: lead ${lead} >= ${b.minLead}` };
      }
    }
    return { rate: rule.baseRate ?? 0, reason: "lead brackets found no match; using base rate" };
  }
  return { rate: rule.baseRate ?? 0, reason: "base rate" };
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
  // Commissions are earned only from collected customer cash, never from a paid-in-full flag alone.
  const paymentProgress = invoiceBase > 0.0005 ? clamp01(paid / invoiceBase) : 0;

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

export function explainCommissionForSalesperson(
  ctx: CommissionComputeContext,
  salespersonName: string
): CommissionRowExplain {
  const rule = ctx.plan.people[salespersonName];
  if (!rule) {
    return {
      salespersonName,
      included: false,
      reason: "no rule in commission plan",
      scope: "primary_only",
      kind: "UNKNOWN",
      active: false,
      override: false,
      rate: 0,
      rateReason: "not applicable",
      basis: Math.max(0, ctx.basis),
      customerPaid: Math.max(0, ctx.customerPaid),
      commissionableTotal: Math.max(0, ctx.commissionableTotal),
      paymentProgress: 0,
      totalCommissionAtRate: 0,
      earnedToDate: 0,
      alreadyPaidCommission: ctx.existingPaidBySalesperson[salespersonName] ?? 0,
      elevatedPaidGuard: { enabled: false, triggered: false, legacyRate: 0, legacyCommission: 0 },
      owed: 0,
    };
  }

  const kind = ctx.kindBySalespersonName[salespersonName] ?? "UNKNOWN";
  const lead = leadNumFromCtx(ctx);
  const scope = effectiveScope(rule, ctx.kindBySalespersonName[salespersonName], lead);
  const active = ctx.activeBySalespersonName[salespersonName] !== false;
  const override = !!ctx.overrides[salespersonName];
  const paidCommission = ctx.existingPaidBySalesperson[salespersonName] ?? 0;
  const invoiceBase = Math.max(0, ctx.commissionableTotal);
  const customerPaid = Math.max(0, ctx.customerPaid);
  const paymentProgress = invoiceBase > 0.0005 ? clamp01(customerPaid / invoiceBase) : 0;
  const basis = Math.max(0, ctx.basis);
  const rateDetail = resolvePersonRateDetail(rule, ctx, salespersonName);
  const totalCommission = basis * rateDetail.rate;
  const earnedToDate = totalCommission * paymentProgress;

  const g = rule.elevatedPaidGuard;
  let legacyRate = 0;
  let legacyCommission = 0;
  let guardTriggered = false;
  if (g && rateDetail.rate === g.elevatedRate) {
    legacyRate = ctx.jobIdNum < g.splitLead ? g.belowRate : g.elseRate;
    legacyCommission = legacyRate * basis;
    guardTriggered = paidCommission >= legacyCommission - 0.01;
  }

  if (!active && !ctx.existingCommissionNamesOnJob.has(salespersonName)) {
    return {
      salespersonName,
      included: false,
      reason: "person inactive and has no existing line on this job",
      scope,
      kind,
      active: false,
      override,
      rate: rateDetail.rate,
      rateReason: rateDetail.reason,
      basis,
      customerPaid,
      commissionableTotal: invoiceBase,
      paymentProgress,
      totalCommissionAtRate: round2(totalCommission),
      earnedToDate: round2(earnedToDate),
      alreadyPaidCommission: paidCommission,
      elevatedPaidGuard: {
        enabled: !!g,
        triggered: guardTriggered,
        legacyRate,
        legacyCommission: round2(legacyCommission),
      },
      owed: 0,
    };
  }

  if (override) {
    return {
      salespersonName,
      included: true,
      reason: "override-locked line; auto recalc skipped",
      scope,
      kind,
      active,
      override: true,
      rate: rateDetail.rate,
      rateReason: rateDetail.reason,
      basis,
      customerPaid,
      commissionableTotal: invoiceBase,
      paymentProgress,
      totalCommissionAtRate: round2(totalCommission),
      earnedToDate: round2(earnedToDate),
      alreadyPaidCommission: paidCommission,
      elevatedPaidGuard: {
        enabled: !!g,
        triggered: guardTriggered,
        legacyRate,
        legacyCommission: round2(legacyCommission),
      },
      owed: 0,
    };
  }

  if (!shouldIncludePerson(salespersonName, rule, ctx)) {
    return {
      salespersonName,
      included: false,
      reason: `scope ${scope} excludes this job (primary is ${ctx.primarySalespersonName ?? "none"})`,
      scope,
      kind,
      active,
      override: false,
      rate: rateDetail.rate,
      rateReason: rateDetail.reason,
      basis,
      customerPaid,
      commissionableTotal: invoiceBase,
      paymentProgress,
      totalCommissionAtRate: round2(totalCommission),
      earnedToDate: round2(earnedToDate),
      alreadyPaidCommission: paidCommission,
      elevatedPaidGuard: {
        enabled: !!g,
        triggered: guardTriggered,
        legacyRate,
        legacyCommission: round2(legacyCommission),
      },
      owed: 0,
    };
  }

  if (guardTriggered) {
    return {
      salespersonName,
      included: true,
      reason: "elevated paid guard triggered (already paid at legacy rate)",
      scope,
      kind,
      active,
      override: false,
      rate: rateDetail.rate,
      rateReason: rateDetail.reason,
      basis,
      customerPaid,
      commissionableTotal: invoiceBase,
      paymentProgress,
      totalCommissionAtRate: round2(totalCommission),
      earnedToDate: round2(earnedToDate),
      alreadyPaidCommission: paidCommission,
      elevatedPaidGuard: {
        enabled: true,
        triggered: true,
        legacyRate,
        legacyCommission: round2(legacyCommission),
      },
      owed: 0,
    };
  }

  return {
    salespersonName,
    included: true,
    reason: "standard commission calculation",
    scope,
    kind,
    active,
    override: false,
    rate: rateDetail.rate,
    rateReason: rateDetail.reason,
    basis,
    customerPaid,
    commissionableTotal: invoiceBase,
    paymentProgress,
    totalCommissionAtRate: round2(totalCommission),
    earnedToDate: round2(earnedToDate),
    alreadyPaidCommission: paidCommission,
    elevatedPaidGuard: {
      enabled: !!g,
      triggered: false,
      legacyRate,
      legacyCommission: round2(legacyCommission),
    },
    owed: owedAfterPaid(earnedToDate, paidCommission),
  };
}
