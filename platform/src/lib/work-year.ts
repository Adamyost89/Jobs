import type { PrismaClient } from "@prisma/client";

/** Default calendar year when no `?year=` is set (Jobs, Commissions, overview, report JSON). */
export function defaultDashboardYear(): number {
  return new Date().getFullYear();
}

/**
 * Prefer the job **work year** with the most rows so operators are not dropped on an empty
 * current calendar year when their book is 2024/2025.
 */
export async function preferredDashboardJobYear(db: PrismaClient): Promise<number> {
  const rows = await db.job.groupBy({
    by: ["year"],
    _count: { _all: true },
  });
  if (!rows.length) return defaultDashboardYear();
  rows.sort((a, b) => {
    const c = (b._count._all ?? 0) - (a._count._all ?? 0);
    if (c !== 0) return c;
    return b.year - a.year;
  });
  return rows[0]!.year;
}

export type WorkYearQueryOpts = {
  /** When set, used instead of calendar year when `?year=` is omitted. */
  defaultYearInt?: number;
  defaultYearSelect?: string;
};

/**
 * Parse `?year=` from Jobs / Commissions URLs:
 * - omit → opts.defaultYearInt ?? current calendar year
 * - `all` → no year filter
 * - `YYYY` → that year
 */
export function parseWorkYearQuery(
  yearParam: string | undefined,
  opts?: WorkYearQueryOpts
): {
  yearInt: number | undefined;
  yearSelectDefault: string;
} {
  const def = opts?.defaultYearInt ?? defaultDashboardYear();
  const defSel = opts?.defaultYearSelect ?? String(def);
  const y = yearParam?.trim().toLowerCase();
  if (y === "all") return { yearInt: undefined, yearSelectDefault: "all" };
  if (y && /^\d{4}$/.test(y)) {
    return { yearInt: parseInt(y, 10), yearSelectDefault: y };
  }
  return { yearInt: def, yearSelectDefault: defSel };
}

/**
 * Years to show in Jobs / Commissions dropdowns: from DB job years, padded around the current year.
 */
export async function distinctJobYearsForSelect(db: PrismaClient): Promise<number[]> {
  const agg = await db.job.aggregate({
    _min: { year: true },
    _max: { year: true },
  });
  const cur = defaultDashboardYear();
  let lo = agg._min.year ?? cur - 5;
  let hi = agg._max.year ?? cur + 1;
  lo = Math.min(lo, cur - 5);
  hi = Math.max(hi, cur + 2);
  const set = new Set<number>();
  for (let y = lo; y <= hi; y++) set.add(y);
  set.add(cur);
  return [...set].sort((a, b) => b - a);
}
