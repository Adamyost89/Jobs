import type { Prisma, PrismaClient } from "@prisma/client";
import { jobNumberSortKey } from "@/lib/job-sort";
import { displaySalespersonName } from "@/lib/salesperson-name";

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
  periodSortDate: Date;
  count: number;
  total: number;
  lastPosted: Date;
  /** Individual payouts in this pay period (AM, then job number). */
  lines: PayoutPeriodLine[];
};

export type PayoutSummaryByRep = {
  payPeriodLabel: string;
  periodSortDate: Date;
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

function parsePayPeriodSortDate(payPeriodLabel: string, fallbackYear: number, fallbackDate: Date): Date {
  const raw = String(payPeriodLabel || "").trim();
  const parseMonthDay = (token: string, defaultYear: number): Date | null => {
    // Supports labels like "Dec 26th", "Dec 26", or "Dec 26, 2025".
    const m = token.trim().match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?$/);
    if (!m) return null;
    const monthRaw = m[1] ?? "";
    const dayRaw = m[2] ?? "";
    const yearRaw = m[3] ?? "";
    const monthIdx = new Date(`${monthRaw} 1, 2000`).getMonth();
    const day = Number.parseInt(dayRaw, 10);
    const year = yearRaw ? Number.parseInt(yearRaw, 10) : defaultYear;
    if (!Number.isFinite(monthIdx) || monthIdx < 0 || monthIdx > 11) return null;
    if (!Number.isFinite(day) || day < 1 || day > 31) return null;
    if (!Number.isFinite(year) || year < 1900 || year > 3000) return null;
    const dt = new Date(Date.UTC(year, monthIdx, day, 12, 0, 0, 0));
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const toFridayPayDate = (dt: Date): Date => {
    // Payday is Friday; move any period end date forward to that week's Friday.
    const dayOfWeek = dt.getUTCDay(); // 0=Sun ... 5=Fri
    const addDays = (5 - dayOfWeek + 7) % 7;
    return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + addDays, 12, 0, 0, 0));
  };

  // Range labels (e.g. "Apr 13, 2026 - Apr 26, 2026"): use period end, then shift to Friday payday.
  const range = raw.match(/^(.*?)\s*[–-]\s*(.*?)$/);
  if (range) {
    const endToken = (range[2] ?? "").trim();
    const end = parseMonthDay(endToken, fallbackYear);
    if (end) return toFridayPayDate(end);
  }

  const single = parseMonthDay(raw, fallbackYear);
  return single ?? fallbackDate;
}

export async function distinctPayoutYearsForSelect(
  prisma: PrismaClient,
  opts?: { salespersonIds?: string[] }
): Promise<number[]> {
  const rows = await prisma.commissionPayout.findMany({
    where:
      opts?.salespersonIds && opts.salespersonIds.length > 0
        ? { salespersonId: { in: opts.salespersonIds } }
        : undefined,
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
    /** When set, only payouts for these salesperson ids. */
    salespersonIds?: string[];
  }
): Promise<{ byWindow: PayoutSummaryWindow[]; byRep: PayoutSummaryByRep[] }> {
  const where: Prisma.CommissionPayoutWhereInput = {};
  const year = opts.payoutYear ?? opts.yearInt;
  if (opts.salespersonIds && opts.salespersonIds.length > 0) {
    where.salespersonId = { in: opts.salespersonIds };
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
  const byPeriodOnly = new Map<string, { total: number; count: number; lastPosted: Date; periodSortDate: Date }>();
  const linesByPeriod = new Map<string, PayoutPeriodLine[]>();

  for (const r of payoutsForSummary) {
    if (year !== undefined && inferPayoutYear(r) !== year) continue;
    const name = displaySalespersonName(r.salesperson.name);
    const amt = r.amount.toNumber();
    const line: PayoutPeriodLine = {
      id: r.id,
      amount: amt,
      salespersonName: name,
      amName: r.job?.salesperson?.name ? displaySalespersonName(r.job.salesperson.name) : null,
      jobNumber: r.job?.jobNumber ?? null,
      jobName: r.job?.name ?? null,
      jobYear: r.job?.year ?? null,
      notes: r.notes,
      createdAt: r.createdAt,
    };
    const bucket = linesByPeriod.get(r.payPeriodLabel) ?? [];
    bucket.push(line);
    linesByPeriod.set(r.payPeriodLabel, bucket);
    const inferredYear = inferPayoutYear(r);
    const periodSortDate = parsePayPeriodSortDate(r.payPeriodLabel, inferredYear, r.createdAt);
    const rk = `${r.payPeriodLabel}\t${name}`;
    const ex = byRepPeriod.get(rk);
    if (!ex) {
      byRepPeriod.set(rk, {
        payPeriodLabel: r.payPeriodLabel,
        periodSortDate,
        salespersonName: name,
        total: amt,
        count: 1,
        lastPosted: r.createdAt,
      });
    } else {
      ex.total += amt;
      ex.count += 1;
      if (r.createdAt > ex.lastPosted) ex.lastPosted = r.createdAt;
      if (periodSortDate > ex.periodSortDate) ex.periodSortDate = periodSortDate;
    }

    const pk = r.payPeriodLabel;
    const pe = byPeriodOnly.get(pk);
    if (!pe) {
      byPeriodOnly.set(pk, { total: amt, count: 1, lastPosted: r.createdAt, periodSortDate });
    } else {
      pe.total += amt;
      pe.count += 1;
      if (r.createdAt > pe.lastPosted) pe.lastPosted = r.createdAt;
      if (periodSortDate > pe.periodSortDate) pe.periodSortDate = periodSortDate;
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
    .sort((a, b) => b.periodSortDate.getTime() - a.periodSortDate.getTime() || b.lastPosted.getTime() - a.lastPosted.getTime());

  const byRep = [...byRepPeriod.values()].sort(
    (a, b) =>
      b.periodSortDate.getTime() - a.periodSortDate.getTime() ||
      b.lastPosted.getTime() - a.lastPosted.getTime() ||
      a.payPeriodLabel.localeCompare(b.payPeriodLabel) ||
      a.salespersonName.localeCompare(b.salespersonName)
  );

  return { byWindow, byRep };
}
