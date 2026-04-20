import type { Prisma, PrismaClient } from "@prisma/client";
import { jobNumberSortKey } from "@/lib/job-sort";

/** One posted check / payout row (for expand-by-period UI). */
export type PayoutPeriodLine = {
  id: string;
  amount: number;
  salespersonName: string;
  /** Job primary salesperson (sheet AM); used for period expand sort. */
  amName: string | null;
  jobNumber: string | null;
  jobName: string | null;
  jobYear: number | null;
  notes: string | null;
  createdAt: Date;
};

export type PayoutSummaryWindow = {
  payPeriodLabel: string;
  count: number;
  total: number;
  lastPosted: Date;
  /** Individual payouts in this pay period (AM, then job number). */
  lines: PayoutPeriodLine[];
};

export type PayoutSummaryByRep = {
  payPeriodLabel: string;
  salespersonName: string;
  count: number;
  total: number;
  lastPosted: Date;
};

function inferPayoutYear(row: {
  createdAt: Date;
  notes?: string | null;
  importSourceKey?: string | null;
}): number {
  const blob = `${row.importSourceKey ?? ""} ${row.notes ?? ""}`;
  const m = blob.match(/total commissions\s*(\d{4})/i);
  if (m) {
    const y = Number.parseInt(m[1] ?? "", 10);
    if (Number.isFinite(y)) return y;
  }
  return row.createdAt.getUTCFullYear();
}

export async function distinctPayoutYearsForSelect(
  prisma: PrismaClient,
  opts?: { salespersonId?: string | null }
): Promise<number[]> {
  const rows = await prisma.commissionPayout.findMany({
    where: opts?.salespersonId ? { salespersonId: opts.salespersonId } : undefined,
    select: { createdAt: true, notes: true, importSourceKey: true },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });
  const years = new Set<number>();
  for (const r of rows) years.add(inferPayoutYear(r));
  return [...years].sort((a, b) => b - a);
}

export async function loadPayoutSummary(
  prisma: PrismaClient,
  opts: {
    yearInt: number | undefined;
    /** When set, filter by payout posted year (createdAt). */
    payoutYear?: number | undefined;
    /** When set, only payouts for this salesperson. */
    salespersonId?: string | null;
  }
): Promise<{ byWindow: PayoutSummaryWindow[]; byRep: PayoutSummaryByRep[] }> {
  const where: Prisma.CommissionPayoutWhereInput = {};
  const year = opts.payoutYear ?? opts.yearInt;
  if (opts.salespersonId) {
    where.salespersonId = opts.salespersonId;
  }

  const payoutsForSummary = await prisma.commissionPayout.findMany({
    where,
    select: {
      id: true,
      payPeriodLabel: true,
      amount: true,
      createdAt: true,
      notes: true,
      importSourceKey: true,
      job: {
        select: {
          jobNumber: true,
          name: true,
          year: true,
          salesperson: { select: { name: true } },
        },
      },
      salesperson: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 8000,
  });

  const byRepPeriod = new Map<string, PayoutSummaryByRep>();
  const byPeriodOnly = new Map<string, { total: number; count: number; lastPosted: Date }>();
  const linesByPeriod = new Map<string, PayoutPeriodLine[]>();

  for (const r of payoutsForSummary) {
    if (year !== undefined && inferPayoutYear(r) !== year) continue;
    const name = r.salesperson.name;
    const amt = r.amount.toNumber();
    const line: PayoutPeriodLine = {
      id: r.id,
      amount: amt,
      salespersonName: name,
      amName: r.job?.salesperson?.name ?? null,
      jobNumber: r.job?.jobNumber ?? null,
      jobName: r.job?.name ?? null,
      jobYear: r.job?.year ?? null,
      notes: r.notes,
      createdAt: r.createdAt,
    };
    const bucket = linesByPeriod.get(r.payPeriodLabel) ?? [];
    bucket.push(line);
    linesByPeriod.set(r.payPeriodLabel, bucket);
    const rk = `${r.payPeriodLabel}\t${name}`;
    const ex = byRepPeriod.get(rk);
    if (!ex) {
      byRepPeriod.set(rk, {
        payPeriodLabel: r.payPeriodLabel,
        salespersonName: name,
        total: amt,
        count: 1,
        lastPosted: r.createdAt,
      });
    } else {
      ex.total += amt;
      ex.count += 1;
      if (r.createdAt > ex.lastPosted) ex.lastPosted = r.createdAt;
    }

    const pk = r.payPeriodLabel;
    const pe = byPeriodOnly.get(pk);
    if (!pe) {
      byPeriodOnly.set(pk, { total: amt, count: 1, lastPosted: r.createdAt });
    } else {
      pe.total += amt;
      pe.count += 1;
      if (r.createdAt > pe.lastPosted) pe.lastPosted = r.createdAt;
    }
  }

  for (const arr of linesByPeriod.values()) {
    arr.sort((a, b) => {
      const aHas = !!a.amName?.trim();
      const bHas = !!b.amName?.trim();
      if (aHas !== bHas) return aHas ? -1 : 1;
      const cmpAm = (a.amName?.trim() ?? "").localeCompare(b.amName?.trim() ?? "", undefined, {
        sensitivity: "base",
      });
      if (cmpAm !== 0) return cmpAm;
      const jnA = a.jobNumber ?? "";
      const jnB = b.jobNumber ?? "";
      const diff = jobNumberSortKey(jnA) - jobNumberSortKey(jnB);
      if (diff !== 0) return diff;
      return jnA.localeCompare(jnB, undefined, { numeric: true });
    });
  }

  const byWindow = [...byPeriodOnly.entries()]
    .map(([payPeriodLabel, v]) => ({
      payPeriodLabel,
      ...v,
      lines: linesByPeriod.get(payPeriodLabel) ?? [],
    }))
    .sort((a, b) => b.lastPosted.getTime() - a.lastPosted.getTime());

  const byRep = [...byRepPeriod.values()].sort(
    (a, b) =>
      b.lastPosted.getTime() - a.lastPosted.getTime() ||
      a.payPeriodLabel.localeCompare(b.payPeriodLabel) ||
      a.salespersonName.localeCompare(b.salespersonName)
  );

  return { byWindow, byRep };
}
