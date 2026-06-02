import type { PrismaClient } from "@prisma/client";
import { signedCalendarMonthForChart } from "@/lib/contract-signed-month";
import { countsTowardSignedTotals } from "@/lib/insurance-job";
import { WAGER_WORK_YEAR } from "@/lib/contract-count-wager";
import {
  buildSeasonalWeights,
  type WorkYearMonthlyCounts,
} from "@/lib/contract-count-seasonal";

export type WagerSeasonalBasis = {
  historicalYears: number[];
  weights: number[];
};

function monthForJob(contractSignedAt: Date | null, createdAt: Date): number {
  const d = contractSignedAt ?? createdAt;
  return signedCalendarMonthForChart(d);
}

/** Company signed-contract counts by calendar month for each work year (matches AM job list rules). */
export async function loadWorkYearMonthlySignedCounts(
  db: PrismaClient,
  years: number[]
): Promise<WorkYearMonthlyCounts[]> {
  if (years.length === 0) return [];

  const jobs = await db.job.findMany({
    where: {
      year: { in: years },
      salespersonId: { not: null },
    },
    select: {
      year: true,
      name: true,
      contractSignedAt: true,
      createdAt: true,
    },
  });

  const byYear = new Map<number, number[]>();
  for (const y of years) byYear.set(y, Array.from({ length: 12 }, () => 0));

  for (const j of jobs) {
    if (!countsTowardSignedTotals(j.name)) continue;
    const months = byYear.get(j.year);
    if (!months) continue;
    const m = monthForJob(j.contractSignedAt, j.createdAt);
    months[m - 1]! += 1;
  }

  return years
    .sort((a, b) => a - b)
    .map((year) => {
      const months = byYear.get(year) ?? Array.from({ length: 12 }, () => 0);
      const total = months.reduce((a, b) => a + b, 0);
      return { year, months, total };
    });
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

  const counts = await loadWorkYearMonthlySignedCounts(db, historicalYears);
  const weights = buildSeasonalWeights(counts);
  return { historicalYears, weights };
}
