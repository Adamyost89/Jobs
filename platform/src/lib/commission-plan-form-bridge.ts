import {
  COMMISSION_PLAN_VERSION,
  type CommissionPersonRuleV1,
  type CommissionPlanConfigV1,
  type CommissionRunningTierPack,
} from "./commission-plan-types";

/** One row in the simple UI: "from this lead # up, use this %". */
export type LeadStepForm = { fromLead: number; usePercent: number };
export type ScopeStepForm = { fromLead: number; useScope: "all_jobs" | "primary_only" };

export type BonusForm = {
  enabled: boolean;
  /** User-friendly labels map to metrics in `editorToRule`. */
  basedOn: "paid_this_year" | "sold_jobs_this_year" | "cash_collected_on_sold_jobs_this_year";
  afterDollars: number;
  /** Commission % after they hit the goal */
  higherPercent: number;
  /** Before goal — flat % (e.g. James 2026) */
  beforeGoalFlatPercent: number | "";
  /** Before goal — split by lead # (James 2025 style) */
  beforeGoalUseLeadSplit: boolean;
  beforeGoalSplitLead: number | "";
  beforeGoalBelowSplitPercent: number | "";
  beforeGoalAtOrAboveSplitPercent: number | "";
  /** Matches old sheet: don't create new owed at the higher % if they were already paid at the old % */
  dontReopenOwedAtHigherRate: boolean;
};

export type CommissionPersonEditor = {
  name: string;
  scope: "all_jobs" | "primary_only";
  /** Optional: from this lead #, use this scope instead of the default scope above. */
  scopeSteps: ScopeStepForm[];
  /** Default / "else" commission % (0–100) */
  defaultPercent: number | "";
  /** Optional: higher lead # = different %. Ignored when bonus uses lead split (handled in bonus section). */
  leadSteps: LeadStepForm[];
  bonus: BonusForm;
};

export const emptyBonusForm = (): BonusForm => ({
  enabled: false,
  basedOn: "paid_this_year",
  afterDollars: 1_000_000,
  higherPercent: 10.5,
  beforeGoalFlatPercent: 10,
  beforeGoalUseLeadSplit: false,
  beforeGoalSplitLead: "",
  beforeGoalBelowSplitPercent: "",
  beforeGoalAtOrAboveSplitPercent: "",
  dontReopenOwedAtHigherRate: false,
});

export function ruleToEditor(name: string, rule: CommissionPersonRuleV1): CommissionPersonEditor {
  const leadSteps: LeadStepForm[] = [];
  const scopeSteps: ScopeStepForm[] = [];
  let defaultPercent: number | "" = (rule.baseRate ?? 0) * 100;

  if (rule.leadBrackets?.length) {
    const sorted = [...rule.leadBrackets].sort((a, b) => b.minLead - a.minLead);
    for (const b of sorted) {
      if (b.minLead <= 0) {
        defaultPercent = Math.round(b.rate * 10000) / 100;
      } else {
        leadSteps.push({ fromLead: b.minLead, usePercent: Math.round(b.rate * 10000) / 100 });
      }
    }
  }

  if (rule.scopeByLead?.length) {
    const sorted = [...rule.scopeByLead].sort((a, b) => b.minLead - a.minLead);
    for (const s of sorted) {
      if (s.minLead > 0) scopeSteps.push({ fromLead: s.minLead, useScope: s.scope });
    }
  }

  const bonus = emptyBonusForm();
  if (rule.runningTiers) {
    bonus.enabled = true;
    bonus.basedOn =
      rule.runningTiers.metric === "ytd_primary_job_basis"
        ? "sold_jobs_this_year"
        : rule.runningTiers.metric === "ytd_primary_paid_amount"
          ? "cash_collected_on_sold_jobs_this_year"
          : "paid_this_year";
    const t0 = rule.runningTiers.tiers[0];
    bonus.afterDollars = t0?.minTotal ?? 0;
    bonus.higherPercent = Math.round((t0?.rate ?? 0) * 10000) / 100;
    const br = rule.runningTiers.belowRates;
    if (br?.flat !== undefined) {
      bonus.beforeGoalFlatPercent = Math.round(br.flat * 10000) / 100;
      bonus.beforeGoalUseLeadSplit = false;
    } else if (br?.byLead) {
      bonus.beforeGoalUseLeadSplit = true;
      bonus.beforeGoalSplitLead = br.byLead.splitLead;
      bonus.beforeGoalBelowSplitPercent = Math.round(br.byLead.belowRate * 10000) / 100;
      bonus.beforeGoalAtOrAboveSplitPercent = Math.round(br.byLead.atOrAboveRate * 10000) / 100;
      bonus.beforeGoalFlatPercent = "";
    }
    bonus.dontReopenOwedAtHigherRate = !!(rule.elevatedPaidGuard && br && "byLead" in br);
  }

  return { name, scope: rule.scope, scopeSteps, defaultPercent, leadSteps, bonus };
}

function num(v: number | "", fallback = 0): number {
  if (v === "" || v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

export function editorToRule(ed: CommissionPersonEditor): CommissionPersonRuleV1 {
  const scope = ed.scope;
  const defPct = num(ed.defaultPercent, 0) / 100;
  const cleanedScopeSteps = ed.scopeSteps
    .filter((s) => s.fromLead > 0)
    .map((s) => ({ minLead: Math.floor(s.fromLead), scope: s.useScope }))
    .sort((a, b) => b.minLead - a.minLead);
  const scopeByLead = cleanedScopeSteps.length > 0 ? [...cleanedScopeSteps, { minLead: 0, scope }] : undefined;

  if (ed.bonus.enabled) {
    const metric =
      ed.bonus.basedOn === "sold_jobs_this_year"
        ? "ytd_primary_job_basis"
        : ed.bonus.basedOn === "cash_collected_on_sold_jobs_this_year"
          ? "ytd_primary_paid_amount"
          : "ytd_paid_commissions";
    const high = num(ed.bonus.higherPercent, 0) / 100;
    const threshold = Math.max(0, num(ed.bonus.afterDollars, 0));

    let belowRates: NonNullable<CommissionRunningTierPack["belowRates"]>;
    if (ed.bonus.beforeGoalUseLeadSplit) {
      belowRates = {
        byLead: {
          splitLead: num(ed.bonus.beforeGoalSplitLead, 0),
          belowRate: num(ed.bonus.beforeGoalBelowSplitPercent, 0) / 100,
          atOrAboveRate: num(ed.bonus.beforeGoalAtOrAboveSplitPercent, 0) / 100,
        },
      };
    } else {
      const fallbackFlat = num(ed.defaultPercent, 0) / 100;
      belowRates = {
        flat: num(ed.bonus.beforeGoalFlatPercent, fallbackFlat * 100) / 100,
      };
    }

    const runningTiers: CommissionRunningTierPack = {
      metric,
      tiers: [{ minTotal: threshold, rate: high }],
      belowRates,
    };

    const rule: CommissionPersonRuleV1 = { scope, scopeByLead, runningTiers };

    if (
      ed.bonus.dontReopenOwedAtHigherRate &&
      ed.bonus.beforeGoalUseLeadSplit &&
      runningTiers.belowRates &&
      "byLead" in runningTiers.belowRates
    ) {
      const bl = runningTiers.belowRates.byLead;
      if (bl != null) {
        rule.elevatedPaidGuard = {
          elevatedRate: high,
          splitLead: bl.splitLead,
          belowRate: bl.belowRate,
          elseRate: bl.atOrAboveRate,
        };
      }
    }
    return rule;
  }

  const cleanedSteps = ed.leadSteps.filter((s) => s.fromLead > 0 && s.usePercent >= 0);
  if (cleanedSteps.length > 0) {
    const brackets = cleanedSteps
      .map((s) => ({ minLead: Math.floor(s.fromLead), rate: num(s.usePercent, 0) / 100 }))
      .sort((a, b) => b.minLead - a.minLead);
    brackets.push({ minLead: 0, rate: defPct });
    return { scope, scopeByLead, leadBrackets: brackets };
  }

  return { scope, scopeByLead, baseRate: defPct };
}

export function planToEditors(plan: CommissionPlanConfigV1): CommissionPersonEditor[] {
  const order = plan.peopleOrder?.length ? plan.peopleOrder : Object.keys(plan.people).sort();
  return order.filter((n) => plan.people[n]).map((n) => ruleToEditor(n, plan.people[n]));
}

export function newPersonEditor(name: string): CommissionPersonEditor {
  return {
    name: name.trim(),
    scope: "primary_only",
    scopeSteps: [],
    defaultPercent: 5,
    leadSteps: [],
    bonus: emptyBonusForm(),
  };
}

export function editorsToPlan(editors: CommissionPersonEditor[]): CommissionPlanConfigV1 {
  const people: Record<string, CommissionPersonRuleV1> = {};
  for (const ed of editors) {
    const name = ed.name.trim();
    if (!name) continue;
    people[name] = editorToRule({ ...ed, name });
  }
  return {
    version: COMMISSION_PLAN_VERSION,
    peopleOrder: editors.map((e) => e.name.trim()).filter(Boolean),
    people,
  };
}
