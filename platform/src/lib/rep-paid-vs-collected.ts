import type { Prisma, PrismaClient } from "@prisma/client";
import { commissionDisplayAmounts, roundMoney } from "@/lib/commission-display";
import { displaySalespersonName } from "@/lib/salesperson-name";

export type RepPaidVsCollectedJob = {
  jobId: string | null;
  jobNumber: string | null;
  jobName: string | null;
  jobYear: number | null;
  isPrimary: boolean;
  collected: number;
  commissionPaid: number;
  commissionOwed: number;
};

export type RepPaidVsCollectedRow = {
  name: string;
  jobCount: number;
  /** Customer cash collected (`Job.amountPaid`) on jobs this rep sold or earns commission on. */
  collected: number;
  commissionPaid: number;
  commissionOwed: number;
  /** Commission paid as a % of collected (null when nothing collected). */
  paidPctOfCollected: number | null;
  jobs: RepPaidVsCollectedJob[];
};

export type RepPaidVsCollectedTotals = {
  /** Distinct jobs only, so a job shared by a rep and a manager is counted once. */
  collected: number;
  commissionPaid: number;
  commissionOwed: number;
};

function inferPayoutYear(row: { createdAt: Date; notes?: string | null; importSourceKey?: string | null }): number {
  const blob = `${row.importSourceKey ?? ""} ${row.notes ?? ""}`;
  const m = blob.match(/total commissions\s*(\d{4})/i);
  if (m) {
    const y = Number.parseInt(m[1] ?? "", 10);
    if (Number.isFinite(y)) return y;
  }
  return row.createdAt.getUTCFullYear();
}

/**
 * Per-rep totals of commission paid vs customer cash collected, filtered by job work year.
 * Paid uses the same ledger + posted-check reconciliation as Commission lines / Payroll log.
 */
export async function loadRepPaidVsCollected(
  db: PrismaClient,
  opts: { yearInt: number | undefined; salespersonIds?: string[] }
): Promise<{ rows: RepPaidVsCollectedRow[]; totals: RepPaidVsCollectedTotals }> {
  const spFilter = opts.salespersonIds ? { in: opts.salespersonIds } : undefined;
  const jobYearFilter: Prisma.JobWhereInput = opts.yearInt !== undefined ? { year: opts.yearInt } : {};

  const jobSelect = { id: true, jobNumber: true, name: true, year: true, amountPaid: true } as const;

  const [commissions, payouts, primaryJobs] = await Promise.all([
    db.commission.findMany({
      where: { ...(spFilter ? { salespersonId: spFilter } : {}), job: jobYearFilter },
      select: {
        jobId: true,
        salespersonId: true,
        paidAmount: true,
        owedAmount: true,
        override: true,
        job: { select: jobSelect },
        salesperson: { select: { name: true, active: true } },
      },
    }),
    db.commissionPayout.findMany({
      where: spFilter ? { salespersonId: spFilter } : undefined,
      select: {
        jobId: true,
        salespersonId: true,
        amount: true,
        createdAt: true,
        notes: true,
        importSourceKey: true,
        job: { select: jobSelect },
        salesperson: { select: { name: true } },
      },
    }),
    db.job.findMany({
      where: { ...jobYearFilter, salespersonId: spFilter ?? { not: null } },
      select: { ...jobSelect, salesperson: { select: { name: true } } },
    }),
  ]);

  type JobInfo = { id: string; jobNumber: string; name: string | null; year: number; amountPaid: Prisma.Decimal | null };
  type RepAgg = { name: string; jobs: Map<string, RepPaidVsCollectedJob> };
  const reps = new Map<string, RepAgg>();
  const collectedByJob = new Map<string, number>();

  const repFor = (rawName: string): RepAgg => {
    const name = displaySalespersonName(rawName) || rawName;
    const key = name.toLowerCase();
    let rep = reps.get(key);
    if (!rep) {
      rep = { name, jobs: new Map() };
      reps.set(key, rep);
    }
    return rep;
  };

  const jobLineFor = (rep: RepAgg, job: JobInfo): RepPaidVsCollectedJob => {
    let line = rep.jobs.get(job.id);
    if (!line) {
      const collected = Math.max(0, job.amountPaid?.toNumber() ?? 0);
      collectedByJob.set(job.id, collected);
      line = {
        jobId: job.id,
        jobNumber: job.jobNumber,
        jobName: job.name,
        jobYear: job.year,
        isPrimary: false,
        collected,
        commissionPaid: 0,
        commissionOwed: 0,
      };
      rep.jobs.set(job.id, line);
    }
    return line;
  };

  const payoutSumByPair = new Map<string, number>();
  for (const p of payouts) {
    if (!p.jobId) continue;
    const k = `${p.jobId}|${p.salespersonId}`;
    payoutSumByPair.set(k, (payoutSumByPair.get(k) ?? 0) + p.amount.toNumber());
  }

  const ledgerPairs = new Set<string>();
  for (const c of commissions) {
    const pairKey = `${c.jobId}|${c.salespersonId}`;
    ledgerPairs.add(pairKey);
    const { displayPaid, displayOwed } = commissionDisplayAmounts(
      c.paidAmount.toNumber(),
      c.owedAmount.toNumber(),
      payoutSumByPair.get(pairKey) ?? 0,
      c.salesperson.active
    );
    const line = jobLineFor(repFor(c.salesperson.name), c.job);
    line.commissionPaid += displayPaid;
    line.commissionOwed += displayOwed;
  }

  for (const j of primaryJobs) {
    if (!j.salesperson) continue;
    jobLineFor(repFor(j.salesperson.name), j).isPrimary = true;
  }

  // Checks with no matching ledger row (e.g. Excel imports with no job link) still count as paid.
  const unlinkedByRep = new Map<string, number>();
  for (const p of payouts) {
    if (p.jobId && ledgerPairs.has(`${p.jobId}|${p.salespersonId}`)) continue;
    const payoutYear = p.job ? p.job.year : inferPayoutYear(p);
    if (opts.yearInt !== undefined && payoutYear !== opts.yearInt) continue;
    const rep = repFor(p.salesperson.name);
    if (p.job) {
      jobLineFor(rep, p.job).commissionPaid += p.amount.toNumber();
    } else {
      const key = rep.name.toLowerCase();
      unlinkedByRep.set(key, (unlinkedByRep.get(key) ?? 0) + p.amount.toNumber());
    }
  }

  const rows: RepPaidVsCollectedRow[] = [...reps.entries()]
    .map(([key, rep]) => {
      const jobs = [...rep.jobs.values()];
      const unlinked = unlinkedByRep.get(key) ?? 0;
      if (unlinked > 0.005) {
        jobs.push({
          jobId: null,
          jobNumber: null,
          jobName: "Checks not linked to a job",
          jobYear: null,
          isPrimary: false,
          collected: 0,
          commissionPaid: unlinked,
          commissionOwed: 0,
        });
      }
      for (const j of jobs) {
        j.commissionPaid = roundMoney(j.commissionPaid);
        j.commissionOwed = roundMoney(j.commissionOwed);
      }
      jobs.sort(
        (a, b) =>
          (a.jobId === null ? 1 : 0) - (b.jobId === null ? 1 : 0) ||
          (b.jobYear ?? 0) - (a.jobYear ?? 0) ||
          (a.jobNumber ?? "").localeCompare(b.jobNumber ?? "", undefined, { numeric: true })
      );
      const collected = roundMoney(jobs.reduce((s, j) => s + j.collected, 0));
      const commissionPaid = roundMoney(jobs.reduce((s, j) => s + j.commissionPaid, 0));
      const commissionOwed = roundMoney(jobs.reduce((s, j) => s + j.commissionOwed, 0));
      return {
        name: rep.name,
        jobCount: jobs.filter((j) => j.jobId !== null).length,
        collected,
        commissionPaid,
        commissionOwed,
        paidPctOfCollected: collected > 0.005 ? (commissionPaid / collected) * 100 : null,
        jobs,
      };
    })
    .filter((r) => r.collected > 0.005 || r.commissionPaid > 0.005 || r.commissionOwed > 0.005)
    .sort((a, b) => b.collected - a.collected || b.commissionPaid - a.commissionPaid || a.name.localeCompare(b.name));

  const totals: RepPaidVsCollectedTotals = {
    collected: roundMoney([...collectedByJob.values()].reduce((s, v) => s + v, 0)),
    commissionPaid: roundMoney(rows.reduce((s, r) => s + r.commissionPaid, 0)),
    commissionOwed: roundMoney(rows.reduce((s, r) => s + r.commissionOwed, 0)),
  };

  return { rows, totals };
}
