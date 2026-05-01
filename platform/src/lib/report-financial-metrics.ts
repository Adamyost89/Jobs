import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/rbac";
import { canRunFullReports } from "@/lib/rbac";
import { displaySalespersonName } from "@/lib/salesperson-name";
import { shouldAutoDeriveChangeOrders } from "@/lib/change-orders";

export type FinancialYearlyPoint = {
  year: number;
  jobCount: number;
  totalContract: number;
  totalChangeOrders: number;
  totalRevenue: number;
  totalInvoiced: number;
  totalCost: number;
  totalGp: number;
  avgCostPerJob: number;
  /** GP as % of contract + change orders, null when revenue is negligible */
  gpMarginPct: number | null;
};

export type FinancialRepRow = {
  salespersonId: string | null;
  name: string;
  jobCount: number;
  totalContract: number;
  totalChangeOrders: number;
  totalRevenue: number;
  totalInvoiced: number;
  totalCost: number;
  totalGp: number;
  gpMarginPct: number | null;
  avgCostPerJob: number;
};

export type JobCostHistoryPoint = {
  at: string;
  cost: number;
};

export type FinancialMetricsAnalytics = {
  scope: "company" | "mine";
  summaryYear: number;
  availableYears: number[];
  yearlyTrend: FinancialYearlyPoint[];
  repSummaries: FinancialRepRow[];
  /** Present when `jobId` was requested and authorized */
  jobCostHistory?: {
    jobId: string;
    jobNumber: string;
    points: JobCostHistoryPoint[];
  };
};

function num(d: { toNumber: () => number }): number {
  return d.toNumber();
}

function effectiveGpForJob(
  revenue: number,
  cost: number,
  costingComplete: boolean
): number {
  if (!Number.isFinite(revenue) || revenue <= 0.005) return 0;
  if (!costingComplete) return 0;
  return revenue - (Number.isFinite(cost) ? cost : 0);
}

function hasGpData(costingComplete: boolean): boolean {
  return costingComplete;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function costFromEventPayload(payload: unknown): number | null {
  if (!isRecord(payload)) return null;
  const patch = payload.patch;
  if (!isRecord(patch)) return null;
  const c = patch.cost;
  if (typeof c !== "number" || !Number.isFinite(c)) return null;
  return c;
}

function costFromSheetSyncPayload(payload: unknown): number | null {
  if (!isRecord(payload)) return null;
  const c = payload.cost;
  if (typeof c === "number" && Number.isFinite(c)) return c;
  return null;
}

function costFromProlinePayload(payload: unknown): number | null {
  if (!isRecord(payload)) return null;
  const v =
    typeof payload.cost === "number"
      ? payload.cost
      : typeof payload.project_cost_actual === "number"
        ? payload.project_cost_actual
        : null;
  if (v === null || !Number.isFinite(v)) return null;
  return v;
}

function costFromJobEventRow(type: string, payload: unknown): number | null {
  if (type === "JOB_SHEET_SYNC") return costFromSheetSyncPayload(payload);
  if (type === "JOB_UPDATED") return costFromEventPayload(payload);
  if (type.startsWith("PROLINE_")) return costFromProlinePayload(payload);
  return null;
}

export async function getJobCostHistoryFromEvents(jobId: string): Promise<JobCostHistoryPoint[]> {
  const events = await prisma.jobEvent.findMany({
    where: {
      jobId,
      OR: [
        { type: { in: ["JOB_UPDATED", "JOB_SHEET_SYNC"] } },
        { type: { startsWith: "PROLINE_" } },
      ],
    },
    select: { type: true, createdAt: true, payload: true },
    orderBy: { createdAt: "asc" },
  });
  const points: JobCostHistoryPoint[] = [];
  for (const ev of events) {
    const cost = costFromJobEventRow(ev.type, ev.payload);
    if (cost === null) continue;
    points.push({ at: ev.createdAt.toISOString(), cost });
  }
  return points;
}

export async function getFinancialMetricsAnalytics(
  user: SessionUser,
  opts: { summaryYear: number; jobId?: string | null; jobNumber?: string | null }
): Promise<FinancialMetricsAnalytics | { error: "forbidden" } | { error: "not_found" }> {
  const full = canRunFullReports(user);
  const repIds = user.salespersonIds;
  if (!full && repIds.length === 0) {
    return { error: "forbidden" };
  }

  const baseWhere = full ? {} : { salespersonId: { in: repIds } };

  let jobForHistory: { id: string; jobNumber: string } | null = null;
  const idTrim = opts.jobId?.trim();
  const numTrim = opts.jobNumber?.trim();
  if (idTrim || numTrim) {
    const job = await prisma.job.findUnique({
      where: idTrim ? { id: idTrim } : { jobNumber: numTrim! },
      select: { id: true, jobNumber: true, salespersonId: true },
    });
    if (!job) return { error: "not_found" };
    if (!full && (!job.salespersonId || !repIds.includes(job.salespersonId))) {
      return { error: "forbidden" };
    }
    jobForHistory = { id: job.id, jobNumber: job.jobNumber };
  }

  const jobsTrend = await prisma.job.findMany({
    where: baseWhere,
    select: {
      year: true,
      status: true,
      prolineStage: true,
      contractAmount: true,
      changeOrders: true,
      invoicedTotal: true,
      cost: true,
      gp: true,
      gpPercent: true,
      costingComplete: true,
    },
  });

  const yearMap = new Map<
    number,
    {
      jobCount: number;
      totalContract: number;
      totalChangeOrders: number;
      totalRevenue: number;
      totalInvoiced: number;
      totalCost: number;
      totalGp: number;
    }
  >();

  for (const j of jobsTrend) {
    const c = num(j.contractAmount);
    const rawCo = num(j.changeOrders);
    const co = shouldAutoDeriveChangeOrders(j.status, j.prolineStage) ? rawCo : 0;
    const inv = num(j.invoicedTotal);
    const cost = num(j.cost);
    const revenue = c + co;
    const gpReady = hasGpData(j.costingComplete === true);
    const g = effectiveGpForJob(revenue, cost, j.costingComplete === true);
    const row =
      yearMap.get(j.year) ??
      {
        jobCount: 0,
        totalContract: 0,
        totalChangeOrders: 0,
        totalRevenue: 0,
        totalInvoiced: 0,
        totalCost: 0,
        totalGp: 0,
      };
    row.jobCount += 1;
    row.totalContract += c;
    row.totalChangeOrders += co;
    row.totalRevenue += revenue;
    row.totalInvoiced += inv;
    row.totalCost += cost;
    if (gpReady) row.totalGp += g;
    yearMap.set(j.year, row);
  }

  const yearlyTrend: FinancialYearlyPoint[] = [...yearMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, v]) => {
      const gpMarginPct =
        v.totalRevenue > 0.005 ? (v.totalGp / v.totalRevenue) * 100 : null;
      return {
        year,
        jobCount: v.jobCount,
        totalContract: v.totalContract,
        totalChangeOrders: v.totalChangeOrders,
        totalRevenue: v.totalRevenue,
        totalInvoiced: v.totalInvoiced,
        totalCost: v.totalCost,
        totalGp: v.totalGp,
        avgCostPerJob: v.jobCount > 0 ? v.totalCost / v.jobCount : 0,
        gpMarginPct,
      };
    });

  const jobsSummary = await prisma.job.findMany({
    where: { ...baseWhere, year: opts.summaryYear },
    include: { salesperson: { select: { id: true, name: true } } },
  });

  const repMap = new Map<
    string,
    {
      salespersonId: string | null;
      name: string;
      jobCount: number;
      totalContract: number;
      totalChangeOrders: number;
      totalRevenue: number;
      totalInvoiced: number;
      totalCost: number;
      totalGp: number;
    }
  >();

  for (const j of jobsSummary) {
    const sid = j.salespersonId;
    const name = j.salesperson?.name ? displaySalespersonName(j.salesperson.name) : "Unassigned";
    const c = num(j.contractAmount);
    const rawCo = num(j.changeOrders);
    const co = shouldAutoDeriveChangeOrders(j.status, j.prolineStage) ? rawCo : 0;
    const inv = num(j.invoicedTotal);
    const cost = num(j.cost);
    const revenue = c + co;
    const gpReady = hasGpData(j.costingComplete === true);
    const g = effectiveGpForJob(revenue, cost, j.costingComplete === true);
    const key = name ? `name:${name.toLowerCase()}` : `__unassigned__`;
    const row =
      repMap.get(key) ??
      {
        salespersonId: sid,
        name,
        jobCount: 0,
        totalContract: 0,
        totalChangeOrders: 0,
        totalRevenue: 0,
        totalInvoiced: 0,
        totalCost: 0,
        totalGp: 0,
      };
    if (row.salespersonId && sid && row.salespersonId !== sid) {
      row.salespersonId = null;
    }
    row.jobCount += 1;
    row.totalContract += c;
    row.totalChangeOrders += co;
    row.totalRevenue += revenue;
    row.totalInvoiced += inv;
    row.totalCost += cost;
    if (gpReady) row.totalGp += g;
    repMap.set(key, row);
  }

  const repSummaries: FinancialRepRow[] = [...repMap.values()]
    .map((r) => ({
      salespersonId: r.salespersonId,
      name: r.name,
      jobCount: r.jobCount,
      totalContract: r.totalContract,
      totalChangeOrders: r.totalChangeOrders,
      totalRevenue: r.totalRevenue,
      totalInvoiced: r.totalInvoiced,
      totalCost: r.totalCost,
      totalGp: r.totalGp,
      gpMarginPct: r.totalRevenue > 0.005 ? (r.totalGp / r.totalRevenue) * 100 : null,
      avgCostPerJob: r.jobCount > 0 ? r.totalCost / r.jobCount : 0,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  let jobCostHistory: FinancialMetricsAnalytics["jobCostHistory"];
  if (jobForHistory) {
    jobCostHistory = {
      jobId: jobForHistory.id,
      jobNumber: jobForHistory.jobNumber,
      points: await getJobCostHistoryFromEvents(jobForHistory.id),
    };
  }

  const availableYears = [...yearMap.keys()].sort((a, b) => a - b);

  return {
    scope: full ? "company" : "mine",
    summaryYear: opts.summaryYear,
    availableYears,
    yearlyTrend,
    repSummaries,
    ...(jobCostHistory ? { jobCostHistory } : {}),
  };
}
