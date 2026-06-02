/** Signed contracts per calendar month (Jan = index 0) for one work year. */
export type WorkYearMonthlyCounts = {
  year: number;
  months: number[];
  total: number;
};

/** Average monthly share of annual signed contracts from prior work years. */
export function buildSeasonalWeights(historical: WorkYearMonthlyCounts[]): number[] {
  const usable = historical.filter((y) => y.total > 0);
  if (usable.length === 0) {
    return Array.from({ length: 12 }, () => 1 / 12);
  }

  const sums = Array.from({ length: 12 }, () => 0);
  for (const y of usable) {
    for (let m = 0; m < 12; m++) {
      sums[m]! += y.months[m]! / y.total;
    }
  }
  const weights = sums.map((s) => s / usable.length);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Array.from({ length: 12 }, () => 1 / 12);
  return weights.map((w) => w / total);
}

function monthFromDateKey(dateKey: string): number {
  return parseInt(dateKey.slice(5, 7), 10);
}

function dayFromDateKey(dateKey: string): number {
  return parseInt(dateKey.slice(8, 10), 10);
}

function yearFromDateKey(dateKey: string): number {
  return parseInt(dateKey.slice(0, 4), 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addCalendarDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

/**
 * Share of a full calendar year's signed contracts expected through `dateKey`
 * (inclusive), using normalized monthly weights. January is typically low.
 */
export function seasonalShareThroughDate(dateKey: string, weights: number[]): number {
  const year = yearFromDateKey(dateKey);
  const month = monthFromDateKey(dateKey);
  const day = dayFromDateKey(dateKey);

  let share = 0;
  for (let m = 1; m < month; m++) share += weights[m - 1]!;
  const dim = daysInMonth(year, month);
  share += weights[month - 1]! * (Math.min(day, dim) / dim);
  return Math.min(1, Math.max(0, share));
}

/** Full-year estimate from YTD count and historical monthly seasonality. */
export function estimatedYearTotalFromSeasonal(
  currentCount: number,
  todayKey: string,
  weights: number[]
): number | null {
  if (currentCount <= 0) return null;
  const share = seasonalShareThroughDate(todayKey, weights);
  if (share <= 0.001) return null;
  return Math.round(currentCount / share);
}

/** Expected cumulative contracts on `dateKey` given current pace vs seasonal curve. */
export function expectedContractsOnDate(
  currentCount: number,
  todayKey: string,
  dateKey: string,
  weights: number[]
): number {
  const shareToday = seasonalShareThroughDate(todayKey, weights);
  if (shareToday <= 0.001) return currentCount;
  const shareDate = seasonalShareThroughDate(dateKey, weights);
  return (currentCount * shareDate) / shareToday;
}

/** First calendar date (on/after today) when seasonal forecast reaches `target`. */
export function projectedHitDateSeasonal(
  current: number,
  todayKey: string,
  target: number,
  weights: number[],
  maxDaysAhead = 800
): string | null {
  if (current >= target) return null;
  const shareToday = seasonalShareThroughDate(todayKey, weights);
  if (shareToday <= 0.001 || current <= 0) return null;

  for (let offset = 0; offset <= maxDaysAhead; offset++) {
    const dateKey = addCalendarDays(todayKey, offset);
    if (expectedContractsOnDate(current, todayKey, dateKey, weights) >= target) {
      return dateKey;
    }
  }
  return null;
}

export function formatSeasonalYearsList(years: number[]): string {
  if (years.length === 0) return "";
  if (years.length === 1) return String(years[0]);
  if (years.length === 2) return `${years[0]} and ${years[1]}`;
  return `${years.slice(0, -1).join(", ")}, and ${years[years.length - 1]}`;
}
