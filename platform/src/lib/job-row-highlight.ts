/** Left-border + tint classes for Jobs table (roughly replaces Excel conditional formatting). */
import type { Prisma } from "@prisma/client";
import { hasDisplayableGp } from "./job-workflow";
import { formatUsd } from "./currency";

export type JobRowHighlight = "good" | "mid" | "bad" | "warn" | "";

/** Decimal fields may be plain numbers on the client after JSON serialization. */
export type JobLike = {
  status: string;
  gp: Prisma.Decimal | number;
  gpPercent: Prisma.Decimal | number;
  projectRevenue: Prisma.Decimal | number;
  invoicedTotal: Prisma.Decimal | number;
  contractAmount: Prisma.Decimal | number;
  changeOrders: Prisma.Decimal | number;
  cost: Prisma.Decimal | number;
  paidInFull: boolean;
};

function num(
  v: Prisma.Decimal | number | null | undefined
): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return v.toNumber();
}

function percentNumber(v: Prisma.Decimal | number | null | undefined): number {
  const n = num(v);
  if (!Number.isFinite(n)) return NaN;
  // Support both stored styles: decimal fraction (0.356) and percent points (35.6).
  return Math.abs(n) <= 1.05 ? n * 100 : n;
}

export type JobHighlightRules = {
  strongGpPct: number;
  mediumGpPct: number;
  thinGpPct: number;
  completeMinGpPct: number;
  minRevenue: number;
};

export const DEFAULT_JOB_HIGHLIGHT_RULES: JobHighlightRules = {
  strongGpPct: 35,
  mediumGpPct: 25,
  thinGpPct: 15,
  completeMinGpPct: 25,
  minRevenue: 500,
};

function revenue(job: JobLike): number {
  const pr = num(job.projectRevenue);
  if (pr > 0) return pr;
  const inv = num(job.invoicedTotal);
  if (inv > 0) return inv;
  return num(job.contractAmount) + num(job.changeOrders);
}

export function jobRowHighlightClass(job: JobLike, rules?: Partial<JobHighlightRules>): string {
  if (!hasDisplayableGp(job)) return "";

  const r = { ...DEFAULT_JOB_HIGHLIGHT_RULES, ...rules };
  const gp = num(job.gp);
  const rev = revenue(job);
  const gpPct = percentNumber(job.gpPercent);
  const st = job.status.toUpperCase();

  if (st.includes("CANCEL")) return "row-hl row-hl--warn";
  if (rev > r.minRevenue && gp < 0) return "row-hl row-hl--bad";
  if (rev > r.minRevenue && gpPct > 0 && gpPct < r.thinGpPct) return "row-hl row-hl--bad";
  if (rev > r.minRevenue && gpPct >= r.strongGpPct) return "row-hl row-hl--good";
  if (rev > r.minRevenue && gpPct >= r.mediumGpPct) return "row-hl row-hl--mid";
  if (st.includes("COMPLETE") && gpPct >= r.completeMinGpPct) return "row-hl row-hl--good";
  if (st.includes("IN_BILLING") && gpPct > 0 && gpPct < r.thinGpPct) return "row-hl row-hl--warn";
  return "";
}

export function formatGpPercent(job: JobLike): string {
  if (!hasDisplayableGp(job)) return "—";
  const n = percentNumber(job.gpPercent);
  if (!Number.isFinite(n) || n === 0) return "—";
  return `${n.toFixed(1)}%`;
}

export function formatJobGpDisplay(job: JobLike): string {
  if (!hasDisplayableGp(job)) return "—";
  return formatUsd(num(job.gp));
}
