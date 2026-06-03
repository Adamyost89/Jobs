import type { PrismaClient } from "@prisma/client";
import { signedCalendarMonthForChart } from "@/lib/contract-signed-month";
import { MONEY_EPSILON, shouldAutoDeriveChangeOrders } from "@/lib/change-orders";
import { countsTowardSignedTotals } from "@/lib/insurance-job";
import { WAGER_WORK_YEAR, chicagoDateKey } from "@/lib/contract-count-wager";
import {
  buildSeasonalWeights,
  type WorkYearMonthlyCounts,
} from "@/lib/contract-count-seasonal";

/** Recent complete work years used for $/contract and GP margin baselines. */
export const WAGER_RECENT_AVG_YEARS = 2;

export type WagerSeasonalBasis = {
  historicalYears: number[];
  weights: number[];
  /** Work years averaged for revenue per priced contract (e.g. 2024–2025). */
  avgRevenueYears: number[];
  /** GP ÷ revenue on costing-complete jobs in recent years. */
  historicalGpMarginPct: number | null;
  /** Mean revenue ÷ priced contract count across recent years. */
  historicalAvgRevenuePerContract: number | null;
};

export type WagerYtdMetrics = {
  count: number;
  revenue: number;
  gp: number;
  /** Revenue on jobs with costing complete (denominator for YTD GP%). */
  gpRevenue: number;
  /** Jobs with signed revenue above placeholder threshold (excludes $0 insurance at sign). */
  pricedCount: number;
  pricedRevenue: number;
  pricedGp: number;
  pricedGpRevenue: number;
  /** Signed jobs still at $0 revenue — typically insurance awaiting update. */
  pendingRevenueCount: number;
  avgRevenuePerPricedContract: number | null;
  /** GP margin on priced, costing-complete jobs (matches AM summary GP%). */
  gpMarginPct: number | null;
  pricedCostedCount: number;
  asOfKey: string;
};

export type WorkYearMonthlyMetrics = WorkYearMonthlyCounts & {
  revenueMonths: number[];
  gpMonths: number[];
  revenueTotal: number;
  gpTotal: number;
  pricedCount: number;
  gpRevenue: number;
};

function num(d: { toNumber: () => number } | null | undefined): number {
  if (!d) return 0;
  return d.toNumber();
}

function effectiveGpForJob(revenue: number, cost: number, costingComplete: boolean): number {
  if (!Number.isFinite(revenue) || revenue <= 0.005) return 0;
  if (!costingComplete) return 0;
  return revenue - (Number.isFinite(cost) ? cost : 0);
}

function monthForJob(contractSignedAt: Date | null, createdAt: Date): number {
  const d = contractSignedAt ?? createdAt;
  return signedCalendarMonthForChart(d);
}

function signDateKey(contractSignedAt: Date | null, createdAt: Date): string {
  const d = contractSignedAt ?? createdAt;
  return chicagoDateKey(d);
}

function isPricedRevenue(revenue: number): boolean {
  return revenue > MONEY_EPSILON;
}

function revenueForJob(j: {
  contractAmount: { toNumber: () => number };
  changeOrders: { toNumber: () => number };
  status: string;
  prolineStage: string | null;
}): number {
  const c = num(j.contractAmount);
  const rawCo = num(j.changeOrders);
  const co = shouldAutoDeriveChangeOrders(j.status, j.prolineStage) ? rawCo : 0;
  return c + co;
}

function avgPerContract(total: number, count: number): number | null {
  if (count <= 0 || total <= MONEY_EPSILON) return null;
  return total / count;
}

type JobRow = {
  year: number;
  name: string | null;
  contractSignedAt: Date | null;
  createdAt: Date;
  status: string;
  prolineStage: string | null;
  contractAmount: { toNumber: () => number };
  changeOrders: { toNumber: () => number };
  cost: { toNumber: () => number } | null;
  costingComplete: boolean | null;
};

function aggregateMonthlyMetrics(jobs: JobRow[], years: number[]): WorkYearMonthlyMetrics[] {
  const byYear = new Map<
    number,
    {
      counts: number[];
      revenue: number[];
      gp: number[];
      revenueTotal: number;
      gpTotal: number;
      pricedCount: number;
      gpRevenue: number;
    }
  >();
  for (const y of years) {
    byYear.set(y, {
      counts: Array.from({ length: 12 }, () => 0),
      revenue: Array.from({ length: 12 }, () => 0),
      gp: Array.from({ length: 12 }, () => 0),
      revenueTotal: 0,
      gpTotal: 0,
      pricedCount: 0,
      gpRevenue: 0,
    });
  }

  for (const j of jobs) {
    if (!countsTowardSignedTotals(j.name)) continue;
    const bucket = byYear.get(j.year);
    if (!bucket) continue;

    const m = monthForJob(j.contractSignedAt, j.createdAt) - 1;
    const revenue = revenueForJob(j);
    const costingComplete = j.costingComplete === true;
    const gp = effectiveGpForJob(revenue, num(j.cost), costingComplete);

    bucket.counts[m]! += 1;
    bucket.revenue[m]! += revenue;
    bucket.revenueTotal += revenue;
    if (isPricedRevenue(revenue)) bucket.pricedCount += 1;
    if (costingComplete && revenue > MONEY_EPSILON) {
      bucket.gp[m]! += gp;
      bucket.gpTotal += gp;
      bucket.gpRevenue += revenue;
    }
  }

  return years
    .sort((a, b) => a - b)
    .map((year) => {
      const b = byYear.get(year)!;
      const total = b.counts.reduce((a, c) => a + c, 0);
      return {
        year,
        months: b.counts,
        total,
        revenueMonths: b.revenue,
        gpMonths: b.gp,
        revenueTotal: b.revenueTotal,
        gpTotal: b.gpTotal,
        pricedCount: b.pricedCount,
        gpRevenue: b.gpRevenue,
      };
    });
}

async function loadCompanyJobsForYears(db: PrismaClient, years: number[]): Promise<JobRow[]> {
  if (years.length === 0) return [];
  return db.job.findMany({
    where: {
      year: { in: years },
      salespersonId: { not: null },
    },
    select: {
      year: true,
      name: true,
      contractSignedAt: true,
      createdAt: true,
      status: true,
      prolineStage: true,
      contractAmount: true,
      changeOrders: true,
      cost: true,
      costingComplete: true,
    },
  });
}

/** Signed contracts per calendar month for each work year (matches AM job list rules). */
export async function loadWorkYearMonthlySignedCounts(
  db: PrismaClient,
  years: number[]
): Promise<WorkYearMonthlyCounts[]> {
  const metrics = await loadWorkYearMonthlyMetrics(db, years);
  return metrics.map(({ year, months, total }) => ({ year, months, total }));
}

export async function loadWorkYearMonthlyMetrics(
  db: PrismaClient,
  years: number[]
): Promise<WorkYearMonthlyMetrics[]> {
  const jobs = await loadCompanyJobsForYears(db, years);
  return aggregateMonthlyMetrics(jobs, years);
}

/** YTD company metrics through `asOfKey` (Chicago calendar, inclusive). */
export async function loadYtdCompanyMetrics(
  db: PrismaClient,
  workYear: number,
  asOfKey: string = chicagoDateKey()
): Promise<WagerYtdMetrics> {
  const jobs = await loadCompanyJobsForYears(db, [workYear]);

  let count = 0;
  let revenue = 0;
  let gp = 0;
  let gpRevenue = 0;
  let pricedCount = 0;
  let pricedRevenue = 0;
  let pricedGp = 0;
  let pricedGpRevenue = 0;
  let pricedCostedCount = 0;

  for (const j of jobs) {
    if (!countsTowardSignedTotals(j.name)) continue;
    if (signDateKey(j.contractSignedAt, j.createdAt) > asOfKey) continue;

    const rev = revenueForJob(j);
    const costingComplete = j.costingComplete === true;
    const g = effectiveGpForJob(rev, num(j.cost), costingComplete);

    count += 1;
    revenue += rev;
    if (costingComplete && rev > MONEY_EPSILON) {
      gp += g;
      gpRevenue += rev;
    }

    if (isPricedRevenue(rev)) {
      pricedCount += 1;
      pricedRevenue += rev;
      if (costingComplete) {
        pricedGp += g;
        pricedGpRevenue += rev;
        pricedCostedCount += 1;
      }
    }
  }

  const gpMarginPct =
    pricedGpRevenue > MONEY_EPSILON ? (pricedGp / pricedGpRevenue) * 100 : null;

  return {
    count,
    revenue,
    gp,
    gpRevenue,
    pricedCount,
    pricedRevenue,
    pricedGp,
    pricedGpRevenue,
    pendingRevenueCount: Math.max(0, count - pricedCount),
    avgRevenuePerPricedContract: avgPerContract(pricedRevenue, pricedCount),
    gpMarginPct,
    pricedCostedCount,
    asOfKey,
  };
}

function recentYearsForAverages(allYears: number[]): number[] {
  return allYears.filter((y) => y < WAGER_WORK_YEAR).slice(-WAGER_RECENT_AVG_YEARS);
}

function historicalGpMarginPct(metrics: WorkYearMonthlyMetrics[], avgYears: number[]): number | null {
  let revenue = 0;
  let gp = 0;
  const yearSet = new Set(avgYears);
  for (const y of metrics) {
    if (!yearSet.has(y.year)) continue;
    revenue += y.gpRevenue;
    gp += y.gpTotal;
  }
  if (revenue <= MONEY_EPSILON) return null;
  return (gp / revenue) * 100;
}

/** Mean revenue ÷ priced contracts for recent complete years (excludes $0 placeholders). */
function historicalAvgRevenuePerPricedContract(
  metrics: WorkYearMonthlyMetrics[],
  avgYears: number[]
): number | null {
  const yearSet = new Set(avgYears);
  const usable = metrics.filter((y) => yearSet.has(y.year) && y.pricedCount > 0);
  if (usable.length === 0) return null;

  let sum = 0;
  for (const y of usable) sum += y.revenueTotal / y.pricedCount;
  return sum / usable.length;
}

/** Prior complete work years used to model Jan/Feb slowdown and summer peaks. */
export async function loadWagerSeasonalBasis(db: PrismaClient): Promise<WagerSeasonalBasis | null> {
  const agg = await db.job.groupBy({
    by: ["year"],
    where: {
      year: { lt: WAGER_WORK_YEAR },
      salespersonId: { not: null },
    },
    _count: { _all: true },
  });

  const historicalYears = agg
    .filter((r) => r._count._all > 0)
    .map((r) => r.year)
    .sort((a, b) => a - b);

  if (historicalYears.length < 2) return null;

  const metrics = await loadWorkYearMonthlyMetrics(db, historicalYears);
  const counts = metrics.map(({ year, months, total }) => ({ year, months, total }));
  const weights = buildSeasonalWeights(counts);
  const avgRevenueYears = recentYearsForAverages(historicalYears);

  return {
    historicalYears,
    weights,
    avgRevenueYears,
    historicalGpMarginPct: historicalGpMarginPct(metrics, avgRevenueYears),
    historicalAvgRevenuePerContract: historicalAvgRevenuePerPricedContract(metrics, avgRevenueYears),
  };
}
