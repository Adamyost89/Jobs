import type { Prisma, PrismaClient } from "@prisma/client";

export type AmSummaryRow = {
  salespersonId: string | null;
  name: string;
  jobCount: number;
  contractAmt: number;
  changeOrders: number;
  total: number;
  gp: number;
  openJobs: number;
  avgPerContract: number;
  /** Contract-weighted mean retail %, or null if no data */
  retailPct: number | null;
  insurancePct: number | null;
  /** GP% of total revenue (total > 0) */
  gpPctOfTotal: number | null;
};

export type AmGrandTotals = Omit<AmSummaryRow, "salespersonId" | "name">;

function num(d: { toNumber: () => number } | null | undefined): number {
  if (!d) return 0;
  return d.toNumber();
}

/** Optional Job columns added in schema — present at runtime only after `npx prisma generate`. */
type JobSheetPct = {
  retailPercent?: { toNumber: () => number } | null;
  insurancePercent?: { toNumber: () => number } | null;
};

function weightedPct(
  jobs: { contractAmount: { toNumber: () => number }; pct: { toNumber: () => number } | null }[]
): number | null {
  let w = 0;
  let c = 0;
  for (const j of jobs) {
    const pct = j.pct;
    if (!pct) continue;
    const co = j.contractAmount.toNumber();
    if (co <= 0) continue;
    w += pct.toNumber() * co;
    c += co;
  }
  if (c <= 0) return null;
  const v = w / c;
  return Number.isFinite(v) ? v : null;
}

/**
 * Account-manager style rollup for one work year (matches sheet “AM / # contracts / …” table).
 */
export async function loadAmSummaryForYear(
  db: PrismaClient,
  where: Prisma.JobWhereInput
): Promise<{ rows: AmSummaryRow[]; grand: AmGrandTotals }> {
  // Jobs with an assigned rep for this work year, including $0 contract rows (still a line on the job list / sheet).
  // Rows with no salesperson stay out of AM buckets (no synthetic “Unassigned” row here).
  const signedWhere: Prisma.JobWhereInput = {
    AND: [where, { salespersonId: { not: null } }],
  };

  // Use `include` only (no `select` with new field names) so a stale Prisma client — before
  // `npx prisma generate` — does not throw PrismaClientValidationError. Sheet % columns appear
  // once the client matches `schema.prisma`.
  const jobs = await db.job.findMany({
    where: signedWhere,
    include: { salesperson: { select: { id: true, name: true } } },
  });

  type Agg = {
    salespersonId: string | null;
    name: string;
    jobCount: number;
    contractAmt: number;
    changeOrders: number;
    total: number;
    gp: number;
    openJobs: number;
    jobsForRetail: { contractAmount: { toNumber: () => number }; pct: { toNumber: () => number } | null }[];
    jobsForIns: { contractAmount: { toNumber: () => number }; pct: { toNumber: () => number } | null }[];
  };

  const map = new Map<string, Agg>();

  for (const j of jobs) {
    const sid = j.salespersonId;
    const name = j.salesperson?.name ?? "Unassigned";
    const key = sid ?? "__unassigned__";
    const row =
      map.get(key) ??
      ({
        salespersonId: sid,
        name,
        jobCount: 0,
        contractAmt: 0,
        changeOrders: 0,
        total: 0,
        gp: 0,
        openJobs: 0,
        jobsForRetail: [],
        jobsForIns: [],
      } satisfies Agg);

    const c = num(j.contractAmount);
    const co = num(j.changeOrders);
    const g = num(j.gp);
    row.jobCount += 1;
    row.contractAmt += c;
    row.changeOrders += co;
    row.total += c + co;
    row.gp += g;
    if (!j.paidInFull) row.openJobs += 1;
    const { retailPercent, insurancePercent } = j as JobSheetPct;
    if (retailPercent) row.jobsForRetail.push({ contractAmount: j.contractAmount, pct: retailPercent });
    if (insurancePercent) row.jobsForIns.push({ contractAmount: j.contractAmount, pct: insurancePercent });
    map.set(key, row);
  }

  const rows: AmSummaryRow[] = [...map.values()]
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
      retailPct: weightedPct(r.jobsForRetail),
      insurancePct: weightedPct(r.jobsForIns),
      gpPctOfTotal: r.total > 0.005 ? (r.gp / r.total) * 100 : null,
    }))
    .sort((a, b) => b.total - a.total);

  const grand: AmGrandTotals = {
    jobCount: 0,
    contractAmt: 0,
    changeOrders: 0,
    total: 0,
    gp: 0,
    openJobs: 0,
    avgPerContract: 0,
    retailPct: null,
    insurancePct: null,
    gpPctOfTotal: null,
  };
  for (const r of rows) {
    grand.jobCount += r.jobCount;
    grand.contractAmt += r.contractAmt;
    grand.changeOrders += r.changeOrders;
    grand.total += r.total;
    grand.gp += r.gp;
    grand.openJobs += r.openJobs;
  }
  grand.avgPerContract = grand.jobCount > 0 ? grand.total / grand.jobCount : 0;
  grand.retailPct = weightedPct(
    jobs
      .map((j) => {
        const { retailPercent } = j as JobSheetPct;
        return retailPercent ? { contractAmount: j.contractAmount, pct: retailPercent } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  );
  grand.insurancePct = weightedPct(
    jobs
      .map((j) => {
        const { insurancePercent } = j as JobSheetPct;
        return insurancePercent ? { contractAmount: j.contractAmount, pct: insurancePercent } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  );
  grand.gpPctOfTotal = grand.total > 0.005 ? (grand.gp / grand.total) * 100 : null;

  return { rows, grand };
}

export function formatPctOrDash(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}
