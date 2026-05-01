import type { Prisma, PrismaClient } from "@prisma/client";
import { displaySalespersonName } from "@/lib/salesperson-name";
import { isInsuranceCustomerName } from "@/lib/insurance-job";

export type AmSummaryRow = {
  salespersonId: string | null;
  name: string;
  jobCount: number;
  contractAmt: number;
  changeOrders: number;
  total: number;
  paid: number;
  gp: number;
  openJobs: number;
  avgPerContract: number;
  /** Revenue-weighted (contract + CO) gross profit margin for retail jobs (name does not start with INS). */
  retailPct: number | null;
  /** Revenue-weighted (contract + CO) gross profit margin for insurance jobs (name starts with INS). */
  insurancePct: number | null;
  /** GP% of total revenue (total > 0) */
  gpPctOfTotal: number | null;
};

export type AmGrandTotals = Omit<AmSummaryRow, "salespersonId" | "name">;

function num(d: { toNumber: () => number } | null | undefined): number {
  if (!d) return 0;
  return d.toNumber();
}

function weightedGpMargin(gp: number, revenue: number): number | null {
  let revenueTotal = 0;
  if (revenue > 0) revenueTotal += revenue;
  if (revenueTotal <= 0) return null;
  const v = (gp / revenueTotal) * 100;
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
    paid: number;
    gp: number;
    openJobs: number;
    retailRevenue: number;
    retailGp: number;
    insRevenue: number;
    insGp: number;
  };

  const map = new Map<string, Agg>();

  for (const j of jobs) {
    const sid = j.salespersonId;
    const name = j.salesperson?.name ? displaySalespersonName(j.salesperson.name) : "Unassigned";
    const key = name ? `name:${name.toLowerCase()}` : "__unassigned__";
    const row =
      map.get(key) ??
      ({
        salespersonId: sid,
        name,
        jobCount: 0,
        contractAmt: 0,
        changeOrders: 0,
        total: 0,
        paid: 0,
        gp: 0,
        openJobs: 0,
        retailRevenue: 0,
        retailGp: 0,
        insRevenue: 0,
        insGp: 0,
      } satisfies Agg);
    if (row.salespersonId && sid && row.salespersonId !== sid) {
      // Combined display row represents multiple salesperson ids.
      row.salespersonId = null;
    }

    const c = num(j.contractAmount);
    const co = num(j.changeOrders);
    const revenue = c + co;
    const paid = num(j.amountPaid);
    const g = num(j.gp);
    row.jobCount += 1;
    row.contractAmt += c;
    row.changeOrders += co;
    row.total += c + co;
    row.paid += paid;
    row.gp += g;
    if (!j.paidInFull) row.openJobs += 1;
    if (isInsuranceCustomerName(j.name)) {
      row.insRevenue += revenue;
      row.insGp += g;
    } else {
      row.retailRevenue += revenue;
      row.retailGp += g;
    }
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
      paid: r.paid,
      gp: r.gp,
      openJobs: r.openJobs,
      avgPerContract: r.jobCount > 0 ? r.total / r.jobCount : 0,
      retailPct: weightedGpMargin(r.retailGp, r.retailRevenue),
      insurancePct: weightedGpMargin(r.insGp, r.insRevenue),
      gpPctOfTotal: r.total > 0.005 ? (r.gp / r.total) * 100 : null,
    }))
    .sort((a, b) => b.total - a.total);

  const grand: AmGrandTotals = {
    jobCount: 0,
    contractAmt: 0,
    changeOrders: 0,
    total: 0,
    paid: 0,
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
    grand.paid += r.paid;
    grand.gp += r.gp;
    grand.openJobs += r.openJobs;
  }
  grand.avgPerContract = grand.jobCount > 0 ? grand.total / grand.jobCount : 0;
  let grandRetailRevenue = 0;
  let grandRetailGp = 0;
  let grandInsRevenue = 0;
  let grandInsGp = 0;
  for (const j of jobs) {
    const revenue = num(j.contractAmount) + num(j.changeOrders);
    const gp = num(j.gp);
    if (isInsuranceCustomerName(j.name)) {
      grandInsRevenue += revenue;
      grandInsGp += gp;
    } else {
      grandRetailRevenue += revenue;
      grandRetailGp += gp;
    }
  }
  grand.retailPct = weightedGpMargin(grandRetailGp, grandRetailRevenue);
  grand.insurancePct = weightedGpMargin(grandInsGp, grandInsRevenue);
  grand.gpPctOfTotal = grand.total > 0.005 ? (grand.gp / grand.total) * 100 : null;

  return { rows, grand };
}

export function formatPctOrDash(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}
