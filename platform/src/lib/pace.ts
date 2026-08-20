import type { PrismaClient } from "@prisma/client";
import { displaySalespersonName } from "@/lib/salesperson-name";
import { countsTowardSignedTotals } from "@/lib/insurance-job";
import { shouldAutoDeriveChangeOrders } from "@/lib/change-orders";
import {
  CONTRACT_SIGN_CHART_TIMEZONE,
  CONTRACT_SIGN_MONTH_LABELS,
  signedCalendarMonthForChart,
} from "@/lib/contract-signed-month";

export type PaceMetricBlock = {
  jobCount: number;
  /** Contract + change orders */
  total: number;
  /** Gross profit $ */
  profit: number;
  gpPct: number | null;
  avgPerContract: number;
};

export type PaceAmRow = {
  name: string;
  ytd: PaceMetricBlock;
  projected: PaceMetricBlock;
  /** Average full-year signed $ across complete prior years (0 if none). */
  historicalAvgAnnualTotal: number;
  historicalAvgAnnualCount: number;
  historicalYearsUsed: number;
};

export type PaceProjection = {
  workYear: number;
  calendarYear: number;
  /** 1–12; through which YTD is measured (current month may be partial). */
  asOfMonth: number;
  /** Fraction of the current month elapsed in America/Chicago (0–1). */
  currentMonthFraction: number;
  isFinal: boolean;
  isFutureYear: boolean;
  ytd: PaceMetricBlock;
  projected: PaceMetricBlock;
  /** Expected share of annual signed $ by “today” from historical seasonality (0–1). */
  expectedShareComplete: number;
  seasonalityYearsUsed: number;
  monthWeights: { month: number; label: string; share: number }[];
  amRows: PaceAmRow[];
};

type MonthBucket = { count: number; total: number; gp: number; gpRevenue: number };

function emptyBucket(): MonthBucket {
  return { count: 0, total: 0, gp: 0, gpRevenue: 0 };
}

function num(d: { toNumber: () => number } | null | undefined): number {
  if (!d) return 0;
  return d.toNumber();
}

function chicagoCalendarParts(now = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CONTRACT_SIGN_CHART_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (type: string) => {
    const v = parts.find((p) => p.type === type)?.value;
    return v ? parseInt(v, 10) : NaN;
  };
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    year: Number.isFinite(year) ? year : now.getFullYear(),
    month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : now.getMonth() + 1,
    day: Number.isFinite(day) && day >= 1 ? day : now.getDate(),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toMetric(count: number, total: number, gp: number, gpRevenue: number): PaceMetricBlock {
  const gpPct = gpRevenue > 0.005 ? (gp / gpRevenue) * 100 : null;
  return {
    jobCount: count,
    total,
    profit: gp,
    gpPct: gpPct !== null && Number.isFinite(gpPct) ? gpPct : null,
    avgPerContract: count > 0 ? total / count : 0,
  };
}

type AmYearAgg = {
  byMonth: MonthBucket[];
  undated: MonthBucket;
  yearTotal: number;
  yearCount: number;
  yearGp: number;
  yearGpRevenue: number;
};

function emptyAmYear(): AmYearAgg {
  const byMonth: MonthBucket[] = [emptyBucket()];
  for (let m = 1; m <= 12; m++) byMonth.push(emptyBucket());
  return {
    byMonth,
    undated: emptyBucket(),
    yearTotal: 0,
    yearCount: 0,
    yearGp: 0,
    yearGpRevenue: 0,
  };
}

/**
 * Seasonality-aware year-end pace for signed contracts (admins / super admins).
 * Prior complete work years supply busy/slow monthly weights; each AM’s historical
 * annual run-rate is blended with their YTD pace early in the year.
 */
export async function computePaceProjection(
  db: PrismaClient,
  workYear: number,
  now = new Date()
): Promise<PaceProjection> {
  const chicago = chicagoCalendarParts(now);
  const calendarYear = chicago.year;

  let asOfMonth: number;
  let currentMonthFraction: number;
  let isFinal: boolean;
  let isFutureYear: boolean;

  if (workYear < calendarYear) {
    asOfMonth = 12;
    currentMonthFraction = 1;
    isFinal = true;
    isFutureYear = false;
  } else if (workYear > calendarYear) {
    asOfMonth = 0;
    currentMonthFraction = 0;
    isFinal = false;
    isFutureYear = true;
  } else {
    asOfMonth = chicago.month;
    currentMonthFraction = Math.min(1, Math.max(0, chicago.day / daysInMonth(chicago.year, chicago.month)));
    isFinal = false;
    isFutureYear = false;
  }

  const jobs = await db.job.findMany({
    where: { salespersonId: { not: null } },
    select: {
      name: true,
      year: true,
      status: true,
      prolineStage: true,
      contractAmount: true,
      changeOrders: true,
      cost: true,
      costingComplete: true,
      contractSignedAt: true,
      salesperson: { select: { name: true } },
    },
  });

  const byAmYear = new Map<string, Map<number, AmYearAgg>>();

  for (const j of jobs) {
    if (!countsTowardSignedTotals(j.name)) continue;
    const amName = j.salesperson?.name ? displaySalespersonName(j.salesperson.name) : "Unassigned";
    let yearMap = byAmYear.get(amName);
    if (!yearMap) {
      yearMap = new Map();
      byAmYear.set(amName, yearMap);
    }
    let agg = yearMap.get(j.year);
    if (!agg) {
      agg = emptyAmYear();
      yearMap.set(j.year, agg);
    }

    const c = num(j.contractAmount);
    const rawCo = num(j.changeOrders);
    const co = shouldAutoDeriveChangeOrders(j.status, j.prolineStage) ? rawCo : 0;
    const revenue = c + co;
    const costingComplete = j.costingComplete === true;
    const gp =
      costingComplete && Number.isFinite(revenue) && revenue > 0.005
        ? revenue - num(j.cost)
        : 0;

    agg.yearTotal += revenue;
    agg.yearCount += 1;
    if (costingComplete) {
      agg.yearGp += gp;
      agg.yearGpRevenue += revenue;
    }

    const bucket =
      j.contractSignedAt != null
        ? agg.byMonth[signedCalendarMonthForChart(j.contractSignedAt)]!
        : agg.undated;
    bucket.count += 1;
    bucket.total += revenue;
    if (costingComplete) {
      bucket.gp += gp;
      bucket.gpRevenue += revenue;
    }
  }

  const priorYears = new Set<number>();
  for (const yearMap of byAmYear.values()) {
    for (const y of yearMap.keys()) {
      if (y < workYear) priorYears.add(y);
    }
  }
  const sortedPrior = [...priorYears].sort((a, b) => a - b);

  // Average each prior year’s monthly $ share → busy/slow curve.
  const shareAccum = Array.from({ length: 13 }, () => 0);
  const seasonalityYears: number[] = [];
  for (const y of sortedPrior) {
    const monthT = Array.from({ length: 13 }, () => 0);
    let yearSigned = 0;
    for (const yearMap of byAmYear.values()) {
      const agg = yearMap.get(y);
      if (!agg) continue;
      for (let m = 1; m <= 12; m++) {
        monthT[m]! += agg.byMonth[m]!.total;
        yearSigned += agg.byMonth[m]!.total;
      }
    }
    if (yearSigned < 1) continue;
    seasonalityYears.push(y);
    for (let m = 1; m <= 12; m++) {
      shareAccum[m]! += monthT[m]! / yearSigned;
    }
  }

  const nSeason = seasonalityYears.length;
  const monthWeights: PaceProjection["monthWeights"] = [];
  let weightSum = 0;
  for (let m = 1; m <= 12; m++) {
    const share = nSeason > 0 ? shareAccum[m]! / nSeason : 1 / 12;
    monthWeights.push({ month: m, label: CONTRACT_SIGN_MONTH_LABELS[m - 1]!, share });
    weightSum += share;
  }
  if (weightSum > 0.0001) {
    for (const w of monthWeights) w.share /= weightSum;
  }

  let expectedShareComplete = 0;
  if (isFutureYear) {
    expectedShareComplete = 0;
  } else if (isFinal) {
    expectedShareComplete = 1;
  } else {
    for (let m = 1; m < asOfMonth; m++) expectedShareComplete += monthWeights[m - 1]!.share;
    expectedShareComplete += monthWeights[asOfMonth - 1]!.share * currentMonthFraction;
  }

  type AmHist = {
    avgTotal: number;
    avgCount: number;
    years: number;
    gpPct: number | null;
  };
  const amHist = new Map<string, AmHist>();
  let histGp = 0;
  let histGpRevenue = 0;

  for (const [amName, yearMap] of byAmYear) {
    let totalSum = 0;
    let countSum = 0;
    let years = 0;
    let gp = 0;
    let gpRevenue = 0;
    for (const y of sortedPrior) {
      const agg = yearMap.get(y);
      if (!agg || agg.yearCount === 0) continue;
      totalSum += agg.yearTotal;
      countSum += agg.yearCount;
      years += 1;
      gp += agg.yearGp;
      gpRevenue += agg.yearGpRevenue;
    }
    histGp += gp;
    histGpRevenue += gpRevenue;
    amHist.set(amName, {
      avgTotal: years > 0 ? totalSum / years : 0,
      avgCount: years > 0 ? countSum / years : 0,
      years,
      gpPct: gpRevenue > 0.005 ? (gp / gpRevenue) * 100 : null,
    });
  }
  const historicalGpPct = histGpRevenue > 0.005 ? (histGp / histGpRevenue) * 100 : null;

  function ytdFromAgg(agg: AmYearAgg | undefined): PaceMetricBlock {
    if (!agg) return toMetric(0, 0, 0, 0);
    if (isFinal) {
      return toMetric(agg.yearCount, agg.yearTotal, agg.yearGp, agg.yearGpRevenue);
    }
    if (isFutureYear) return toMetric(0, 0, 0, 0);

    let count = 0;
    let total = 0;
    let gp = 0;
    let gpRevenue = 0;
    for (let m = 1; m <= asOfMonth; m++) {
      const b = agg.byMonth[m]!;
      count += b.count;
      total += b.total;
      gp += b.gp;
      gpRevenue += b.gpRevenue;
    }
    count += agg.undated.count;
    total += agg.undated.total;
    gp += agg.undated.gp;
    gpRevenue += agg.undated.gpRevenue;
    return toMetric(count, total, gp, gpRevenue);
  }

  // Trust YTD pace more once ~28% of historical annual volume is expected.
  const paceBlend = expectedShareComplete <= 0 ? 0 : Math.min(1, expectedShareComplete / 0.28);
  const scale =
    expectedShareComplete > 0.02 && !isFinal && !isFutureYear ? 1 / expectedShareComplete : 1;

  const amRows: PaceAmRow[] = [];
  let ytdCount = 0;
  let ytdTotal = 0;
  let ytdGp = 0;
  let ytdGpRevenue = 0;
  let projCount = 0;
  let projTotal = 0;
  let projProfit = 0;

  for (const amName of [...byAmYear.keys()].sort((a, b) => a.localeCompare(b))) {
    const yearMap = byAmYear.get(amName)!;
    const ytd = ytdFromAgg(yearMap.get(workYear));
    const hist = amHist.get(amName);
    const historicalAvgAnnualTotal = hist?.avgTotal ?? 0;
    const historicalAvgAnnualCount = hist?.avgCount ?? 0;
    const histYears = hist?.years ?? 0;
    const gpPctFallback = ytd.gpPct ?? hist?.gpPct ?? historicalGpPct;

    let projected: PaceMetricBlock;
    if (isFinal || isFutureYear) {
      projected = { ...ytd };
    } else {
      const paceTotal = ytd.total * scale;
      const paceCount = ytd.jobCount * scale;
      let blendedTotal = paceTotal;
      let blendedCount = paceCount;
      if (histYears > 0 && historicalAvgAnnualTotal > 0.005) {
        blendedTotal = paceBlend * paceTotal + (1 - paceBlend) * historicalAvgAnnualTotal;
        blendedCount = paceBlend * paceCount + (1 - paceBlend) * historicalAvgAnnualCount;
      }
      blendedTotal = Math.max(ytd.total, blendedTotal);
      blendedCount = Math.max(ytd.jobCount, blendedCount);
      const jobCount = Math.round(blendedCount);
      const profit =
        gpPctFallback != null && Number.isFinite(gpPctFallback)
          ? blendedTotal * (gpPctFallback / 100)
          : ytd.profit * scale;
      projected = {
        jobCount,
        total: blendedTotal,
        profit: Math.max(ytd.profit, profit),
        gpPct: gpPctFallback,
        avgPerContract: jobCount > 0 ? blendedTotal / jobCount : ytd.avgPerContract,
      };
    }

    if (ytd.jobCount === 0 && projected.jobCount === 0 && historicalAvgAnnualTotal < 0.005) {
      continue;
    }

    amRows.push({
      name: amName,
      ytd,
      projected,
      historicalAvgAnnualTotal,
      historicalAvgAnnualCount,
      historicalYearsUsed: histYears,
    });

    ytdCount += ytd.jobCount;
    ytdTotal += ytd.total;
    ytdGp += ytd.profit;
    // Recover gp-eligible revenue from the metric (profit / pct) when pct known;
    // otherwise re-read from agg for accuracy.
    const workAgg = yearMap.get(workYear);
    if (isFinal && workAgg) {
      ytdGpRevenue += workAgg.yearGpRevenue;
    } else if (!isFutureYear && workAgg) {
      for (let m = 1; m <= asOfMonth; m++) ytdGpRevenue += workAgg.byMonth[m]!.gpRevenue;
      ytdGpRevenue += workAgg.undated.gpRevenue;
    }

    projCount += projected.jobCount;
    projTotal += projected.total;
    projProfit += projected.profit;
  }

  amRows.sort((a, b) => b.projected.total - a.projected.total);

  const ytdBlock = toMetric(ytdCount, ytdTotal, ytdGp, ytdGpRevenue);
  const companyGpPct = ytdBlock.gpPct ?? historicalGpPct;
  const projectedBlock: PaceMetricBlock =
    isFinal
      ? ytdBlock
      : isFutureYear
        ? toMetric(0, 0, 0, 0)
        : {
            jobCount: projCount,
            total: projTotal,
            profit: projProfit,
            gpPct: companyGpPct,
            avgPerContract: projCount > 0 ? projTotal / projCount : 0,
          };

  return {
    workYear,
    calendarYear,
    asOfMonth: asOfMonth || 1,
    currentMonthFraction,
    isFinal,
    isFutureYear,
    ytd: ytdBlock,
    projected: projectedBlock,
    expectedShareComplete,
    seasonalityYearsUsed: seasonalityYears.length,
    monthWeights,
    amRows,
  };
}
