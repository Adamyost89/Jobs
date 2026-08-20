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
  /** Average full-year signed $ across prior years (partial tenure years are annualized). */
  historicalAvgAnnualTotal: number;
  historicalAvgAnnualCount: number;
  /** Historical average signed $ per contract (0 if none). */
  historicalAvgPerContract: number;
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
 * Fraction of the calendar year an AM appears active, from first→last month with a
 * signed date. Mid-year starts (e.g. James in 2024) return < 1 so we can annualize.
 * Returns null when there is too little dated activity to trust (< ~3 months).
 */
function activeYearFraction(agg: AmYearAgg): number | null {
  let first = 0;
  let last = 0;
  for (let m = 1; m <= 12; m++) {
    if (agg.byMonth[m]!.count <= 0) continue;
    if (first === 0) first = m;
    last = m;
  }
  if (first === 0) {
    // Undated-only year — cannot detect a partial start; treat as full year if any volume.
    return agg.yearCount > 0 ? 1 : null;
  }
  const months = last - first + 1;
  if (months < 3) return null;
  return months / 12;
}

/** Annualize a partial tenure year to a full-year run-rate (no-op when fraction is 1). */
function annualizeForHistory(
  agg: AmYearAgg
): { total: number; count: number; gp: number; gpRevenue: number } | null {
  const fraction = activeYearFraction(agg);
  if (fraction == null || fraction <= 0) return null;
  return {
    total: agg.yearTotal / fraction,
    count: agg.yearCount / fraction,
    gp: agg.yearGp,
    gpRevenue: agg.yearGpRevenue,
  };
}

/**
 * Seasonality-aware year-end pace for signed contracts (admins / super admins).
 * Prior complete work years supply busy/slow monthly weights. Contract count,
 * signed $, avg/contract, and GP% always blend seasonality-scaled YTD with each
 * AM’s historical annual averages (sample-weighted; does not fade mid-year).
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
    avgPerContract: number;
    years: number;
    gpPct: number | null;
  };
  const amHist = new Map<string, AmHist>();
  let histGp = 0;
  let histGpRevenue = 0;
  let histCompanyTotal = 0;
  let histCompanyCount = 0;

  for (const [amName, yearMap] of byAmYear) {
    let totalSum = 0;
    let countSum = 0;
    let actualTotalSum = 0;
    let actualCountSum = 0;
    let years = 0;
    let gp = 0;
    let gpRevenue = 0;
    for (const y of sortedPrior) {
      const agg = yearMap.get(y);
      if (!agg || agg.yearCount === 0) continue;
      const annualized = annualizeForHistory(agg);
      if (!annualized) continue;
      totalSum += annualized.total;
      countSum += annualized.count;
      actualTotalSum += agg.yearTotal;
      actualCountSum += agg.yearCount;
      years += 1;
      gp += annualized.gp;
      gpRevenue += annualized.gpRevenue;
    }
    histGp += gp;
    histGpRevenue += gpRevenue;
    histCompanyTotal += totalSum;
    histCompanyCount += countSum;
    amHist.set(amName, {
      avgTotal: years > 0 ? totalSum / years : 0,
      avgCount: years > 0 ? countSum / years : 0,
      // Ticket size from actual contracts (annualizing cancels out on $/contract).
      avgPerContract: actualCountSum > 0 ? actualTotalSum / actualCountSum : 0,
      years,
      gpPct: gpRevenue > 0.005 ? (gp / gpRevenue) * 100 : null,
    });
  }
  const historicalGpPct = histGpRevenue > 0.005 ? (histGp / histGpRevenue) * 100 : null;
  const historicalCompanyAvgPerContract =
    histCompanyCount > 0 ? histCompanyTotal / histCompanyCount : 0;

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

  /** Always-on blend of a YTD/pace value with historical — does not fade out mid-year. */
  function blendWithHistory(
    current: number,
    historical: number,
    currentWeight: number,
    historicalWeight: number
  ): number {
    if (!(historical > 0.005) || historicalWeight <= 0) return current;
    if (!(current > 0.005) || currentWeight <= 0) return historical;
    return (current * currentWeight + historical * historicalWeight) / (currentWeight + historicalWeight);
  }

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
  let projGpPctWeight = 0;
  let projGpPctAccum = 0;

  for (const amName of [...byAmYear.keys()].sort((a, b) => a.localeCompare(b))) {
    const yearMap = byAmYear.get(amName)!;
    const workAgg = yearMap.get(workYear);
    // Only AMs with signed contracts in the selected work year.
    if (!workAgg || workAgg.yearCount === 0) continue;

    const ytd = ytdFromAgg(workAgg);
    if (!isFinal && !isFutureYear && ytd.jobCount === 0) continue;

    const hist = amHist.get(amName);
    const historicalAvgAnnualTotal = hist?.avgTotal ?? 0;
    const historicalAvgAnnualCount = hist?.avgCount ?? 0;
    const historicalAvgPerContract = hist?.avgPerContract ?? 0;
    const histYears = hist?.years ?? 0;
    const histGpPct = hist?.gpPct ?? null;

    const ytdWeight = Math.max(ytd.jobCount, 1);
    const histWeight = histYears > 0 ? Math.max(historicalAvgAnnualCount, 1) : 0;

    let projected: PaceMetricBlock;
    if (isFinal || isFutureYear) {
      projected = { ...ytd };
    } else {
      const paceCount = ytd.jobCount * scale;
      const paceTotal = ytd.total * scale;

      const jobCount = Math.max(
        ytd.jobCount,
        Math.round(blendWithHistory(paceCount, historicalAvgAnnualCount, ytdWeight, histWeight))
      );

      const histAvgTicket =
        historicalAvgPerContract > 0.005
          ? historicalAvgPerContract
          : historicalCompanyAvgPerContract > 0.005
            ? historicalCompanyAvgPerContract
            : 0;
      let avgPerContract = blendWithHistory(
        ytd.avgPerContract,
        histAvgTicket,
        ytdWeight,
        histWeight
      );

      // Signed $: blend seasonality-scaled YTD $ with historical annual $, and with count × avg.
      const fromPaceAndHist = blendWithHistory(
        paceTotal,
        historicalAvgAnnualTotal,
        ytdWeight,
        histWeight
      );
      const fromCountTimesAvg = jobCount * avgPerContract;
      let total = Math.max(ytd.total, (fromPaceAndHist + fromCountTimesAvg) / 2);
      if (jobCount > 0) avgPerContract = total / jobCount;

      const ytdGpPct = ytd.gpPct;
      const histGpForBlend = histGpPct ?? historicalGpPct;
      let gpPct: number | null;
      if (ytdGpPct != null && histGpForBlend != null) {
        gpPct = blendWithHistory(ytdGpPct, histGpForBlend, ytdWeight, histWeight);
      } else {
        gpPct = ytdGpPct ?? histGpForBlend;
      }

      const profit =
        gpPct != null && Number.isFinite(gpPct) ? total * (gpPct / 100) : Math.max(ytd.profit, ytd.profit * scale);

      projected = {
        jobCount: Math.max(1, jobCount),
        total,
        profit: Math.max(ytd.profit, profit),
        gpPct,
        avgPerContract,
      };
    }

    amRows.push({
      name: amName,
      ytd,
      projected,
      historicalAvgAnnualTotal,
      historicalAvgAnnualCount,
      historicalAvgPerContract,
      historicalYearsUsed: histYears,
    });

    ytdCount += ytd.jobCount;
    ytdTotal += ytd.total;
    ytdGp += ytd.profit;
    if (isFinal) {
      ytdGpRevenue += workAgg.yearGpRevenue;
    } else if (!isFutureYear) {
      for (let m = 1; m <= asOfMonth; m++) ytdGpRevenue += workAgg.byMonth[m]!.gpRevenue;
      ytdGpRevenue += workAgg.undated.gpRevenue;
    }

    projCount += projected.jobCount;
    projTotal += projected.total;
    projProfit += projected.profit;
    if (projected.gpPct != null && projected.total > 0.005) {
      projGpPctAccum += projected.gpPct * projected.total;
      projGpPctWeight += projected.total;
    }
  }

  amRows.sort((a, b) => b.projected.total - a.projected.total);

  const ytdBlock = toMetric(ytdCount, ytdTotal, ytdGp, ytdGpRevenue);
  const projectedGpPct =
    projGpPctWeight > 0.005
      ? projGpPctAccum / projGpPctWeight
      : ytdBlock.gpPct ?? historicalGpPct;
  const projectedBlock: PaceMetricBlock =
    isFinal
      ? ytdBlock
      : isFutureYear
        ? toMetric(0, 0, 0, 0)
        : {
            jobCount: projCount,
            total: projTotal,
            profit: projProfit,
            gpPct: projectedGpPct,
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
