import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/rbac";
import { canRunFullReports } from "@/lib/rbac";
import { displaySalespersonName } from "@/lib/salesperson-name";
import {
  CONTRACT_SIGN_CHART_TIMEZONE,
  CONTRACT_SIGN_MONTH_LABELS,
  signedCalendarMonthForChart,
} from "@/lib/contract-signed-month";

export type YearlyTrendPoint = {
  year: number;
  contracts: number;
  changeOrders: number;
  total: number;
  gp: number;
  jobCount: number;
};

export type RepSummaryRow = {
  salespersonId: string | null;
  name: string;
  jobCount: number;
  contractAmt: number;
  changeOrders: number;
  total: number;
  gp: number;
  avgPerContract: number;
  openJobs: number;
  /** Contract-weighted mean, null if no jobs carry the field */
  retailPct: number | null;
  insurancePct: number | null;
  /** GP as % of total revenue for the rep’s book */
  gpPctOfTotal: number | null;
};

export type SignedContractsAnalytics = {
  scope: "company" | "mine";
  summaryYear: number;
  monthlyYear: number;
  /** Distinct job years in scope (for year pickers) */
  availableYears: number[];
  yearlyTrend: YearlyTrendPoint[];
  repSummaries: RepSummaryRow[];
  /** Rows Jan–Dec with dollars (contract + change orders) per rep + Other */
  monthlyStacked: { monthLabel: string; [key: string]: string | number }[];
  /** Total number of signed jobs per monthly row label (Jan–Dec plus optional Undated). */
  monthlySignedCounts: { monthLabel: string; count: number }[];
  monthlyTopRepNames: string[];
  /** IANA zone used to map each `contractSignedAt` instant to a calendar month on the chart */
  monthlyChartTimeZone: string;
  /** Jobs in the monthly slice that have a sign date (attributed to Jan–Dec) */
  jobsWithSignDateForMonth: number;
  /** Jobs with contract dollars but no `contractSignedAt` — shown in the Undated bar, not spread across months */
  jobsUndatedNoSignDate: number;
  /** Sum of contract + change orders in the Undated bucket */
  undatedSignedRevenue: number;
  /** Rep display name → salesperson id for monthly chart drill-down (excludes unmapped / unassigned). */
  salespersonIdByRepName: Record<string, string>;
};

type JobSheetPct = {
  retailPercent?: { toNumber: () => number } | null;
  insurancePercent?: { toNumber: () => number } | null;
};

function num(d: { toNumber: () => number }): number {
  return d.toNumber();
}

export async function getSignedContractsAnalytics(
  user: SessionUser,
  opts: { summaryYear: number; monthlyYear: number }
): Promise<SignedContractsAnalytics | { error: "forbidden" }> {
  const full = canRunFullReports(user);
  const repIds = user.salespersonIds;
  if (!full && repIds.length === 0) {
    return { error: "forbidden" };
  }

  const baseWhere = full ? {} : { salespersonId: { in: repIds } };
  const signedBaseWhere = {
    ...baseWhere,
    salespersonId: {
      not: null as string | null,
      ...(full ? {} : { in: repIds }),
    },
  };

  const jobsTrend = await prisma.job.findMany({
    where: signedBaseWhere,
    select: {
      year: true,
      contractAmount: true,
      changeOrders: true,
      gp: true,
    },
  });

  const yearMap = new Map<
    number,
    { contracts: number; changeOrders: number; total: number; gp: number; jobCount: number }
  >();
  for (const j of jobsTrend) {
    const c = num(j.contractAmount);
    const co = num(j.changeOrders);
    const g = num(j.gp);
    const row = yearMap.get(j.year) ?? {
      contracts: 0,
      changeOrders: 0,
      total: 0,
      gp: 0,
      jobCount: 0,
    };
    row.contracts += c;
    row.changeOrders += co;
    row.total += c + co;
    row.gp += g;
    row.jobCount += 1;
    yearMap.set(j.year, row);
  }
  const yearlyTrend: YearlyTrendPoint[] = [...yearMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, v]) => ({
      year,
      contracts: v.contracts,
      changeOrders: v.changeOrders,
      total: v.total,
      gp: v.gp,
      jobCount: v.jobCount,
    }));

  // `include` only avoids PrismaClientValidationError when the generated client is older than
  // `schema.prisma` (e.g. Windows EPERM during `prisma generate`). Sheet % fields load once the client is regenerated.
  const jobsSummary = await prisma.job.findMany({
    where: { ...signedBaseWhere, year: opts.summaryYear },
    include: { salesperson: { select: { id: true, name: true } } },
  });

  const repMap = new Map<
    string,
    {
      salespersonId: string | null;
      name: string;
      jobCount: number;
      contractAmt: number;
      changeOrders: number;
      total: number;
      gp: number;
      openJobs: number;
      retailW: number;
      retailContract: number;
      insW: number;
      insContract: number;
    }
  >();

  for (const j of jobsSummary) {
    const sid = j.salespersonId;
    const name = j.salesperson?.name ? displaySalespersonName(j.salesperson.name) : "Unassigned";
    const c = num(j.contractAmount);
    const co = num(j.changeOrders);
    const g = num(j.gp);
    const key = name ? `name:${name.toLowerCase()}` : `__unassigned__`;
    const row = repMap.get(key) ?? {
      salespersonId: sid,
      name,
      jobCount: 0,
      contractAmt: 0,
      changeOrders: 0,
      total: 0,
      gp: 0,
      openJobs: 0,
      retailW: 0,
      retailContract: 0,
      insW: 0,
      insContract: 0,
    };
    if (row.salespersonId && sid && row.salespersonId !== sid) {
      row.salespersonId = null;
    }
    row.jobCount += 1;
    row.contractAmt += c;
    row.changeOrders += co;
    row.total += c + co;
    row.gp += g;
    if (!j.paidInFull) row.openJobs += 1;
    const { retailPercent, insurancePercent } = j as JobSheetPct;
    if (retailPercent && c > 0) {
      row.retailW += retailPercent.toNumber() * c;
      row.retailContract += c;
    }
    if (insurancePercent && c > 0) {
      row.insW += insurancePercent.toNumber() * c;
      row.insContract += c;
    }
    repMap.set(key, row);
  }

  const repSummaries: RepSummaryRow[] = [...repMap.values()]
    .map((r) => ({
      salespersonId: r.salespersonId,
      name: r.name,
      jobCount: r.jobCount,
      contractAmt: r.contractAmt,
      changeOrders: r.changeOrders,
      total: r.total,
      gp: r.gp,
      openJobs: r.openJobs,
      avgPerContract: r.jobCount > 0 ? r.total / r.jobCount : 0,
      retailPct: r.retailContract > 0 ? r.retailW / r.retailContract : null,
      insurancePct: r.insContract > 0 ? r.insW / r.insContract : null,
      gpPctOfTotal: r.total > 0.005 ? (r.gp / r.total) * 100 : null,
    }))
    .sort((a, b) => b.total - a.total);

  const jobsMonthly = await prisma.job.findMany({
    where: { ...signedBaseWhere, year: opts.monthlyYear },
    select: {
      contractSignedAt: true,
      createdAt: true,
      contractAmount: true,
      changeOrders: true,
      salesperson: { select: { id: true, name: true } },
    },
  });

  const repTotals = new Map<string, number>();
  const monthRep = new Map<number, Map<string, number>>();
  for (let m = 1; m <= 12; m++) monthRep.set(m, new Map());
  const monthCounts = new Map<number, number>();
  for (let m = 1; m <= 12; m++) monthCounts.set(m, 0);
  const undatedRep = new Map<string, number>();
  const salespersonIdByRepName: Record<string, string> = {};

  let jobsWithSignDateForMonth = 0;
  let jobsUndatedNoSignDate = 0;
  let undatedSignedRevenue = 0;

  for (const j of jobsMonthly) {
    const name = j.salesperson?.name ? displaySalespersonName(j.salesperson.name) : "Unassigned";
    const sid = j.salesperson?.id;
    if (sid && !salespersonIdByRepName[name]) salespersonIdByRepName[name] = sid;
    const dollars = num(j.contractAmount) + num(j.changeOrders);
    repTotals.set(name, (repTotals.get(name) ?? 0) + dollars);

    if (j.contractSignedAt) {
      jobsWithSignDateForMonth += 1;
      const month = signedCalendarMonthForChart(j.contractSignedAt);
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
      const inner = monthRep.get(month)!;
      inner.set(name, (inner.get(name) ?? 0) + dollars);
    } else {
      jobsUndatedNoSignDate += 1;
      undatedSignedRevenue += dollars;
      undatedRep.set(name, (undatedRep.get(name) ?? 0) + dollars);
    }
  }

  const sortedReps = [...repTotals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const maxStackKeys = full ? 8 : 12;
  const monthlyTopRepNames = sortedReps.slice(0, maxStackKeys);
  const topSet = new Set(monthlyTopRepNames);

  const monthlyStacked: { monthLabel: string; [key: string]: string | number }[] = [];
  const monthlySignedCounts: { monthLabel: string; count: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    const monthLabel = CONTRACT_SIGN_MONTH_LABELS[m - 1];
    const row: { monthLabel: string; [key: string]: string | number } = {
      monthLabel,
    };
    let other = 0;
    const inner = monthRep.get(m)!;
    for (const [repName, v] of inner) {
      if (topSet.has(repName)) row[repName] = v;
      else other += v;
    }
    if (other > 0) row["Other"] = other;
    for (const n of monthlyTopRepNames) {
      if (row[n] === undefined) row[n] = 0;
    }
    monthlyStacked.push(row);
    monthlySignedCounts.push({ monthLabel, count: monthCounts.get(m) ?? 0 });
  }

  if (undatedSignedRevenue > 0.005) {
    const row: { monthLabel: string; [key: string]: string | number } = { monthLabel: "Undated" };
    let other = 0;
    for (const [repName, v] of undatedRep) {
      if (topSet.has(repName)) row[repName] = v;
      else other += v;
    }
    if (other > 0) row["Other"] = other;
    for (const n of monthlyTopRepNames) {
      if (row[n] === undefined) row[n] = 0;
    }
    monthlyStacked.push(row);
    monthlySignedCounts.push({ monthLabel: "Undated", count: jobsUndatedNoSignDate });
  }

  const availableYears = [...yearMap.keys()].sort((a, b) => a - b);

  return {
    scope: full ? "company" : "mine",
    summaryYear: opts.summaryYear,
    monthlyYear: opts.monthlyYear,
    availableYears,
    yearlyTrend,
    repSummaries,
    monthlyStacked,
    monthlySignedCounts,
    monthlyTopRepNames,
    monthlyChartTimeZone: CONTRACT_SIGN_CHART_TIMEZONE,
    jobsWithSignDateForMonth,
    jobsUndatedNoSignDate,
    undatedSignedRevenue,
    salespersonIdByRepName,
  };
}
