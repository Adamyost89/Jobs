import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canEditJobs, canViewAllJobs } from "@/lib/rbac";
import { JobsTableSection, type JobsTableRowDTO } from "@/components/JobsTableSection";
import { Prisma } from "@prisma/client";
import { sortJobsByJobNumber } from "@/lib/job-sort";
import {
  defaultDashboardYear,
  distinctJobYearsForSelect,
  parseWorkYearQuery,
  preferredDashboardJobYear,
} from "@/lib/work-year";
import Link from "next/link";
import { signedCalendarMonthForChart } from "@/lib/contract-signed-month";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";
import { displaySalespersonName } from "@/lib/salesperson-name";
import { normalizeStatusBadgeColorMap } from "@/lib/status-badge-colors";

/**
 * Jobs list query params (GET):
 * - `year` — job work year or `all`
 * - `sp` — salesperson id
 * - `spn` — salesperson display-name token (matches full-name rows that start with that token)
 * - `q`, `status`, `sort` — search / status / sort direction
 * - `signedMonth` — 1–12: filter to jobs whose contract signed calendar month in America/Chicago matches
 *   (same rule as signed-contracts reports; see contract-signed-month.ts)
 * - `signedUndated` — present and not false/0: `contractSignedAt` is null
 */
type Search = {
  q?: string;
  year?: string;
  sp?: string;
  spn?: string;
  status?: string;
  sort?: string;
  signedMonth?: string;
  signedUndated?: string;
};

function pickString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await getSession();
  if (!user) return null;
  const canSeeGp = canViewAllJobs(user);

  const sp = await searchParams;
  const q = pickString(sp.q)?.trim();
  const yearParamRaw = pickString(sp.year);
  const yearParam = yearParamRaw?.trim().toLowerCase();
  const spId = pickString(sp.sp)?.trim();
  const spNameToken = pickString(sp.spn)?.trim();
  const status = pickString(sp.status)?.trim();
  const sortDir = pickString(sp.sort) === "asc" ? "asc" : "desc";

  const signedMonthRaw = pickString(sp.signedMonth)?.trim();
  let signedMonthInt: number | undefined;
  if (signedMonthRaw) {
    const n = parseInt(signedMonthRaw, 10);
    if (n >= 1 && n <= 12) signedMonthInt = n;
  }
  const signedUndatedRaw = pickString(sp.signedUndated);
  const signedUndated =
    signedUndatedRaw !== undefined &&
    signedUndatedRaw.trim() !== "" &&
    signedUndatedRaw.trim().toLowerCase() !== "0" &&
    signedUndatedRaw.trim().toLowerCase() !== "false";

  const preferredY = await preferredDashboardJobYear(prisma);
  const { yearInt, yearSelectDefault } = parseWorkYearQuery(yearParamRaw, {
    defaultYearInt: preferredY,
    defaultYearSelect: String(preferredY),
  });
  const calendarY = defaultDashboardYear();
  const yearOptsSet = new Set(await distinctJobYearsForSelect(prisma));
  if (yearSelectDefault !== "all") {
    const n = parseInt(yearSelectDefault, 10);
    if (!Number.isNaN(n)) yearOptsSet.add(n);
  }
  const yearOpts = [...yearOptsSet].sort((a, b) => b - a);

  const parts: Prisma.JobWhereInput[] = [];
  if (!canViewAllJobs(user)) {
    parts.push(
      user.salespersonIds.length > 0
        ? { salespersonId: { in: user.salespersonIds } }
        : { id: "__none__" }
    );
  }
  if (yearInt !== undefined) parts.push({ year: yearInt });
  if (spId) parts.push({ salespersonId: spId });
  if (spNameToken) {
    parts.push({
      OR: [
        {
          salesperson: {
            is: { name: { equals: spNameToken, mode: Prisma.QueryMode.insensitive } },
          },
        },
        {
          salesperson: {
            is: { name: { startsWith: `${spNameToken} `, mode: Prisma.QueryMode.insensitive } },
          },
        },
      ],
    });
  }
  if (status) {
    parts.push({
      status: { contains: status, mode: Prisma.QueryMode.insensitive },
    });
  }
  if (q) {
    parts.push({
      OR: [
        { jobNumber: { contains: q, mode: Prisma.QueryMode.insensitive } },
        { leadNumber: { contains: q, mode: Prisma.QueryMode.insensitive } },
        { name: { contains: q, mode: Prisma.QueryMode.insensitive } },
      ],
    });
  }

  if (signedUndated) {
    parts.push({ contractSignedAt: null });
  }

  // Sheet-only reserved job # rows (unsigned / no customer): never list them here.
  parts.push({
    NOT: {
      AND: [
        { status: "UNKNOWN" },
        { leadNumber: null },
        { salespersonId: null },
        { contractAmount: { equals: 0 } },
        { invoicedTotal: { equals: 0 } },
        { changeOrders: { equals: 0 } },
        { projectRevenue: { equals: 0 } },
        { OR: [{ name: null }, { name: "" }] },
      ],
    },
  });

  let where: Prisma.JobWhereInput =
    parts.length === 0 ? {} : parts.length === 1 ? parts[0]! : { AND: parts };

  const salespeople = await prisma.salesperson.findMany({
    orderBy: { name: "asc" },
    where: { active: true },
  });
  const salespersonOptions = (() => {
    const byName = new Map<string, { id: string; name: string }>();
    for (const s of salespeople) {
      const display = displaySalespersonName(s.name);
      const key = display.toLowerCase();
      if (!byName.has(key)) byName.set(key, { id: s.id, name: display });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  /** Signed-month slice matches report charts (Chicago calendar month of `contractSignedAt`). */
  let signedMonthFilter: number | undefined;
  if (!signedUndated && signedMonthInt !== undefined) {
    signedMonthFilter = signedMonthInt;
    const baseWhere: Prisma.JobWhereInput =
      parts.length === 0 ? {} : parts.length === 1 ? parts[0]! : { AND: parts };
    const whereWithDate: Prisma.JobWhereInput = {
      AND: [baseWhere, { contractSignedAt: { not: null } }],
    };
    const candidates = await prisma.job.findMany({
      where: whereWithDate,
      select: { id: true, contractSignedAt: true },
    });
    const ids = candidates
      .filter(
        (j) =>
          j.contractSignedAt != null &&
          signedCalendarMonthForChart(j.contractSignedAt) === signedMonthFilter
      )
      .map((j) => j.id);
    where = { AND: [baseWhere, ids.length > 0 ? { id: { in: ids } } : { id: "__none__" }] };
  }

  const jobsRaw = await prisma.job.findMany({
    where,
    take: 5000,
    include: { salesperson: true },
  });

  const jobs = sortJobsByJobNumber(jobsRaw, sortDir);

  const jobIds = jobs.map((j) => j.id);
  const commByJob = new Map<string, { paid: number; owed: number }>();
  if (jobIds.length > 0) {
    const sums = await prisma.commission.groupBy({
      by: ["jobId"],
      where: { jobId: { in: jobIds } },
      _sum: { paidAmount: true, owedAmount: true },
    });
    for (const g of sums) {
      commByJob.set(g.jobId, {
        paid: g._sum.paidAmount?.toNumber() ?? 0,
        owed: g._sum.owedAmount?.toNumber() ?? 0,
      });
    }
  }

  const hasFilters = Boolean(
    q ||
      spId ||
      spNameToken ||
      status ||
      sortDir === "asc" ||
      yearParam === "all" ||
      (yearParam && /^\d{4}$/.test(yearParam) && parseInt(yearParam, 10) !== preferredY) ||
      signedUndated ||
      signedMonthFilter !== undefined
  );

  const tableRows: JobsTableRowDTO[] = jobs.map((j) => {
    const cx = commByJob.get(j.id);
    return {
      id: j.id,
      jobNumber: j.jobNumber,
      year: j.year,
      contractSignedAt: j.contractSignedAt ? j.contractSignedAt.toISOString() : null,
      leadNumber: j.leadNumber,
      name: j.name,
      salespersonName: j.salesperson?.name ? displaySalespersonName(j.salesperson.name) : null,
      status: j.status,
      prolineStage: j.prolineStage,
      contractAmount: j.contractAmount.toNumber(),
      changeOrders: j.changeOrders.toNumber(),
      invoicedTotal: j.invoicedTotal.toNumber(),
      amountPaid: j.amountPaid?.toNumber() ?? null,
      paidDate: j.paidDate ? j.paidDate.toISOString() : null,
      retailPercent: j.retailPercent?.toNumber() ?? null,
      insurancePercent: j.insurancePercent?.toNumber() ?? null,
      cost: j.cost.toNumber(),
      paidInFull: j.paidInFull,
      gp: canSeeGp ? j.gp.toNumber() : 0,
      gpPercent: canSeeGp ? j.gpPercent.toNumber() : 0,
      projectRevenue: canSeeGp ? j.projectRevenue.toNumber() : 0,
      commPaid: cx ? cx.paid : null,
      commOwed: cx ? cx.owed : null,
    };
  });

  const statusColorRows = await prisma.$queryRaw<Array<{ statusBadgeColors: unknown }>>(
    Prisma.sql`SELECT "statusBadgeColors" FROM "SystemConfig" WHERE "id" = 'singleton' LIMIT 1`
  );
  const statusBadgeColors = normalizeStatusBadgeColorMap(statusColorRows[0]?.statusBadgeColors);

  return (
    <div className="page-stack page-stack--full">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "0.75rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750, letterSpacing: "-0.02em" }}>Jobs</h1>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)", maxWidth: 560 }}>
          Default year <strong>{yearSelectDefault === "all" ? "all" : yearSelectDefault}</strong>{" "}
          {yearParamRaw ? "" : `(default is current calendar year ${calendarY}). `}
          <Link href="/dashboard/archives">Archives</Link> for quick year links.
          {canEditJobs(user) ? (
            <>
              {" "}
              <Link href="/dashboard/data/import-jobs">Import jobs</Link> ·{" "}
              <Link href="/dashboard/data/import-payouts">Import payouts</Link>
            </>
          ) : null}
        </p>
      </div>

      <form method="get" className="card" style={{ padding: "1rem 1.15rem" }}>
        {spNameToken ? <input type="hidden" name="spn" value={spNameToken} /> : null}
        <div className="filter-bar">
          {signedMonthFilter !== undefined ? (
            <input type="hidden" name="signedMonth" value={String(signedMonthFilter)} />
          ) : null}
          {signedUndated ? <input type="hidden" name="signedUndated" value="1" /> : null}
          <label>
            Search
            <input name="q" defaultValue={q || ""} placeholder="Job #, lead, customer…" style={{ minWidth: 200 }} />
          </label>
          <label>
            Year
            <select name="year" defaultValue={yearSelectDefault} style={{ minWidth: 120 }}>
              {yearOpts.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
              <option value="all">All years</option>
            </select>
          </label>
          {canViewAllJobs(user) && (
            <label>
              Salesperson
              <select name="sp" defaultValue={spId || ""} style={{ minWidth: 140 }}>
                <option value="">All</option>
                {salespersonOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Status contains
            <input name="status" defaultValue={status || ""} placeholder="Billing, Sold…" style={{ minWidth: 140 }} />
          </label>
          <label>
            Sort job #
            <select name="sort" defaultValue={sortDir} style={{ minWidth: 200 }}>
              <option value="desc">Newest first (high → low)</option>
              <option value="asc">Oldest first</option>
            </select>
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" type="submit">
              Apply
            </button>
            <a
              href={jobsDrilldownUrl({
                year: yearSelectDefault === "all" ? "all" : parseInt(yearSelectDefault, 10) || preferredY,
              })}
              className="btn secondary"
              style={{ textDecoration: "none" }}
            >
              Reset
            </a>
          </div>
        </div>
      </form>

      <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
        <strong style={{ color: "var(--text)" }}>{jobs.length}</strong> job{jobs.length === 1 ? "" : "s"}
        {hasFilters ? " match filters" : ""} · sort {sortDir === "desc" ? "newest first" : "oldest first"}
        <span style={{ display: "block", marginTop: "0.35rem", fontSize: "0.82rem" }}>
          Commission columns = <strong>all reps</strong> on that job (incl. manager lines).
        </span>
      </p>

      <JobsTableSection rows={tableRows} user={user} statusBadgeColors={statusBadgeColors} />
    </div>
  );
}
