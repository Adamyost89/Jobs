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
  collectedCommissionBase: number;
  totalCommissionAtRate: number;
  earnedToDate: number;
  earnedToDateNote?: string;
  alreadyPaidCommission: number;
  runningTierSnapshot: {
    metric: "ytd_paid_commissions" | "ytd_primary_job_basis" | "ytd_primary_paid_amount" | null;
    currentValue: number;
    nextThreshold: number | null;
    dollarsToNextThreshold: number;
  };
  elevatedPaidGuard: {
    enabled: boolean;
    triggered: boolean;
    legacyRate: number;
    legacyCommission: number;
  };
  owed: number;
};

function runningTierSnapshotFor(
  rule: CommissionPersonRuleV1 | undefined,
  totals: { ytdPaid: number; ytdPrimaryBasis: number; ytdPrimaryPaidAmount: number }
): CommissionRowExplain["runningTierSnapshot"] {
  if (!rule?.runningTiers) {
    return { metric: null, currentValue: 0, nextThreshold: null, dollarsToNextThreshold: 0 };
  }
  const pack = rule.runningTiers;
  const currentValue =
    pack.metric === "ytd_paid_commissions"
      ? totals.ytdPaid
      : pack.metric === "ytd_primary_paid_amount"
        ? totals.ytdPrimaryPaidAmount
        : totals.ytdPrimaryBasis;
  const asc = [...pack.tiers].sort((a, b) => a.minTotal - b.minTotal);
  const next = asc.find((t) => currentValue + 0.0001 < t.minTotal);
  return {
    metric: pack.metric,
    currentValue: round2(currentValue),
    nextThreshold: next ? round2(next.minTotal) : null,
    dollarsToNextThreshold: next ? round2(Math.max(0, next.minTotal - currentValue)) : 0,
  };
}

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

function canonicalSalespersonIdentity(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = String(raw).trim().toLowerCase();
  if (!trimmed) return "";
  const [first = ""] = trimmed.split(/\s+/);
  return first.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

function isPrimarySalespersonMatch(
  primarySalespersonName: string | null | undefined,
  salespersonName: string
): boolean {
  const primary = canonicalSalespersonIdentity(primarySalespersonName);
  const current = canonicalSalespersonIdentity(salespersonName);
  return primary !== "" && current !== "" && primary === current;
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
  totals: { ytdPaid: number; ytdPrimaryBasis: number; ytdPrimaryPaidAmount: number }
): number {
  const running =
    pack.metric === "ytd_paid_commissions"
      ? totals.ytdPaid
      : pack.metric === "ytd_primary_paid_amount"
        ? totals.ytdPrimaryPaidAmount
        : totals.ytdPrimaryBasis;
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

function runningMetricValue(
  pack: CommissionRunningTierPack,
  totals: { ytdPaid: number; ytdPrimaryBasis: number; ytdPrimaryPaidAmount: number }
): number {
  return pack.metric === "ytd_paid_commissions"
    ? totals.ytdPaid
    : pack.metric === "ytd_primary_paid_amount"
      ? totals.ytdPrimaryPaidAmount
      : totals.ytdPrimaryBasis;
}

function rateFromRunningTiersAtValue(pack: CommissionRunningTierPack, jobIdNum: number, runningValue: number): number {
  const sorted = [...pack.tiers].sort((a, b) => b.minTotal - a.minTotal);
  for (const t of sorted) {
    if (runningValue >= t.minTotal) return t.rate;
  }
  const br = pack.belowRates;
  if (br?.byLead) {
    return jobIdNum < br.byLead.splitLead ? br.byLead.belowRate : br.byLead.atOrAboveRate;
  }
  if (br?.flat !== undefined) return br.flat;
  return 0;
}

function metricContributionFromCurrentJob(
  pack: CommissionRunningTierPack,
  ctx: CommissionComputeContext,
  salespersonName: string
): number {
  const isPrimary = isPrimarySalespersonMatch(ctx.primarySalespersonName, salespersonName);
  if (!isPrimary) return 0;
  if (pack.metric === "ytd_primary_paid_amount") return Math.max(0, ctx.customerPaid);
  if (pack.metric === "ytd_primary_job_basis") return Math.max(0, ctx.basis);
  return 0;
}

function earnedToDateWithRunningTierProgression(
  rule: CommissionPersonRuleV1,
  ctx: CommissionComputeContext,
  salespersonName: string,
  totals: { ytdPaid: number; ytdPrimaryBasis: number; ytdPrimaryPaidAmount: number },
  collectedCommissionBase: number
): number | null {
  const pack = rule.runningTiers;
  if (!pack) return null;
  if (pack.metric !== "ytd_primary_paid_amount") return null;
  const contribution = metricContributionFromCurrentJob(pack, ctx, salespersonName);
  if (contribution <= 0 || collectedCommissionBase <= 0) return null;

  const currentRunning = runningMetricValue(pack, totals);
  const startRunning = Math.max(0, currentRunning - contribution);
  const thresholdsAsc = [...pack.tiers].sort((a, b) => a.minTotal - b.minTotal);

  let remainingBase = Math.max(0, collectedCommissionBase);
  let runningCursor = startRunning;
  let earned = 0;
  while (remainingBase > 0.000001) {
    const rate = rateFromRunningTiersAtValue(pack, ctx.jobIdNum, runningCursor + 0.000001);
    const nextThreshold = thresholdsAsc.find((t) => runningCursor + 0.000001 < t.minTotal);
    const segmentCap = nextThreshold ? Math.max(0, nextThreshold.minTotal - runningCursor) : remainingBase;
    const segment = Math.min(remainingBase, segmentCap);
    if (segment <= 0.000001) break;
    earned += segment * rate;
    remainingBase -= segment;
    runningCursor += segment;
  }
  return earned;
}

function earnedToDateNoteWithRunningTierProgression(
  rule: CommissionPersonRuleV1,
  ctx: CommissionComputeContext,
  salespersonName: string,
  totals: { ytdPaid: number; ytdPrimaryBasis: number; ytdPrimaryPaidAmount: number },
  collectedCommissionBase: number
): string | null {
  const pack = rule.runningTiers;
  if (!pack || pack.metric !== "ytd_primary_paid_amount") return null;
  const contribution = metricContributionFromCurrentJob(pack, ctx, salespersonName);
  if (contribution <= 0 || collectedCommissionBase <= 0) return null;
  const currentRunning = runningMetricValue(pack, totals);
  const startRunning = Math.max(0, currentRunning - contribution);
  const thresholdsAsc = [...pack.tiers].sort((a, b) => a.minTotal - b.minTotal);
  const nextThreshold = thresholdsAsc.find((t) => startRunning + 0.0001 < t.minTotal);
  if (!nextThreshold) return null;
  const lowerRate = rateFromRunningTiersAtValue(pack, ctx.jobIdNum, startRunning + 0.000001);
  const higherRate = rateFromRunningTiersAtValue(pack, ctx.jobIdNum, nextThreshold.minTotal + 0.000001);
  if (Math.abs(lowerRate - higherRate) < 0.0000001) return null;
  const lowerPortion = Math.max(0, Math.min(collectedCommissionBase, nextThreshold.minTotal - startRunning));
  const higherPortion = Math.max(0, collectedCommissionBase - lowerPortion);
  return `marginal tier: ${round2(lowerPortion)} @ ${(lowerRate * 100).toFixed(2)}% + ${round2(
    higherPortion
  )} @ ${(higherRate * 100).toFixed(2)}%`;
}

function resolvePersonRate(rule: CommissionPersonRuleV1, ctx: CommissionComputeContext, salespersonName: string): number {
  const totals = ctx.tierTotals[salespersonName] ?? { ytdPaid: 0, ytdPrimaryBasis: 0, ytdPrimaryPaidAmount: 0 };
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
  const totals = ctx.tierTotals[salespersonName] ?? { ytdPaid: 0, ytdPrimaryBasis: 0, ytdPrimaryPaidAmount: 0 };
  if (rule.runningTiers) {
    const pack = rule.runningTiers;
    const running = runningMetricValue(pack, totals);
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
  return isPrimarySalespersonMatch(ctx.primarySalespersonName, salespersonName);
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
  // Commissions are earned from collected customer cash to date.
  const collectedCommissionBase = paid;

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
    const totals = ctx.tierTotals[sp] ?? { ytdPaid: 0, ytdPrimaryBasis: 0, ytdPrimaryPaidAmount: 0 };
    const earnedToDate =
      earnedToDateWithRunningTierProgression(rule, ctx, sp, totals, collectedCommissionBase) ??
      collectedCommissionBase * rate;

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
  const totals = ctx.tierTotals[salespersonName] ?? { ytdPaid: 0, ytdPrimaryBasis: 0, ytdPrimaryPaidAmount: 0 };
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
      collectedCommissionBase: Math.max(0, ctx.customerPaid),
      totalCommissionAtRate: 0,
      earnedToDate: 0,
      alreadyPaidCommission: ctx.existingPaidBySalesperson[salespersonName] ?? 0,
      runningTierSnapshot: runningTierSnapshotFor(undefined, totals),
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
  const collectedCommissionBase = customerPaid;
  const basis = Math.max(0, ctx.basis);
  const rateDetail = resolvePersonRateDetail(rule, ctx, salespersonName);
  const totalCommission = basis * rateDetail.rate;
  const earnedToDate =
    earnedToDateWithRunningTierProgression(rule, ctx, salespersonName, totals, collectedCommissionBase) ??
    collectedCommissionBase * rateDetail.rate;
  const earnedToDateNote =
    earnedToDateNoteWithRunningTierProgression(rule, ctx, salespersonName, totals, collectedCommissionBase) ??
    undefined;

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
      collectedCommissionBase,
      totalCommissionAtRate: round2(totalCommission),
      earnedToDate: round2(earnedToDate),
      earnedToDateNote,
      alreadyPaidCommission: paidCommission,
      runningTierSnapshot: runningTierSnapshotFor(rule, totals),
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
      collectedCommissionBase,
      totalCommissionAtRate: round2(totalCommission),
      earnedToDate: round2(earnedToDate),
      earnedToDateNote,
      alreadyPaidCommission: paidCommission,
      runningTierSnapshot: runningTierSnapshotFor(rule, totals),
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
    const primaryDisplay = ctx.primarySalespersonName ?? "none";
    return {
      salespersonName,
      included: false,
      reason: `scope ${scope} excludes this job (primary is ${primaryDisplay})`,
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
      collectedCommissionBase,
      totalCommissionAtRate: round2(totalCommission),
      earnedToDate: round2(earnedToDate),
      earnedToDateNote,
      alreadyPaidCommission: paidCommission,
      runningTierSnapshot: runningTierSnapshotFor(rule, totals),
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
      collectedCommissionBase,
      totalCommissionAtRate: round2(totalCommission),
      earnedToDate: round2(earnedToDate),
      earnedToDateNote,
      alreadyPaidCommission: paidCommission,
      runningTierSnapshot: runningTierSnapshotFor(rule, totals),
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
    collectedCommissionBase,
    totalCommissionAtRate: round2(totalCommission),
    earnedToDate: round2(earnedToDate),
    earnedToDateNote,
    alreadyPaidCommission: paidCommission,
    runningTierSnapshot: runningTierSnapshotFor(rule, totals),
    elevatedPaidGuard: {
      enabled: !!g,
      triggered: false,
      legacyRate,
      legacyCommission: round2(legacyCommission),
    },
    owed: owedAfterPaid(earnedToDate, paidCommission),
  };
}
