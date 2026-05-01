import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canEditJobs, canViewAllJobs } from "@/lib/rbac";
import { JobsTableSection, type JobsTableRowDTO } from "@/components/JobsTableSection";
import { Prisma } from "@prisma/client";
import { normalizeJobsSortParam, sortJobs } from "@/lib/job-sort";
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
import { normalizeStatusBadgeColorMap, statusColumnLabel } from "@/lib/status-badge-colors";
import { quoteLinksByJobIds } from "@/lib/job-quote-links";
import { isInsuranceCustomerName } from "@/lib/insurance-job";

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

const MONEY_EPSILON = 0.005;

function looksPaidAndClosedStatus(statusRaw: string): boolean {
  const s = statusRaw.trim().toLowerCase();
  if (!s) return false;
  return (
    s.includes("paid in full") ||
    s.includes("invoice paid") ||
    (s.includes("paid") && s.includes("closed")) ||
    s.includes("complete")
  );
}

function marginPctForJob(revenue: number, cost: number, gp: number): number | null {
  if (!Number.isFinite(revenue) || revenue <= MONEY_EPSILON) return null;
  if (Number.isFinite(cost) && Math.abs(cost) > MONEY_EPSILON) {
    return ((revenue - cost) / revenue) * 100;
  }
  return gp / revenue * 100;
}

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
  const sortKey = normalizeJobsSortParam(pickString(sp.sort));
  const effectiveSortKey = !canSeeGp && (sortKey === "gp_desc" || sortKey === "gp_asc") ? "job_desc" : sortKey;

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

  // Build status options from the current base slice (before status filtering),
  // using the same display logic as the table column.
  const whereBeforeStatus = where;
  const statusSourceRows = await prisma.job.findMany({
    where: whereBeforeStatus,
    select: { status: true, prolineStage: true },
    take: 5000,
  });
  const statusOptions = [...new Set(
    statusSourceRows
      .map((row) => statusColumnLabel(row.status, row.prolineStage).trim())
      .filter((label) => label.length > 0)
  )].sort((a, b) => a.localeCompare(b));

  if (status) {
    const withStatus: Prisma.JobWhereInput = {
      OR: [
        { prolineStage: { equals: status, mode: Prisma.QueryMode.insensitive } },
        { status: { equals: status, mode: Prisma.QueryMode.insensitive } },
      ],
    };
    where = { AND: [whereBeforeStatus, withStatus] };
  }

  const jobsRaw = await prisma.job.findMany({
    where,
    take: 5000,
    include: { salesperson: true },
  });

  const jobs = sortJobs(jobsRaw, effectiveSortKey);
  const quoteLinksByJob = await quoteLinksByJobIds(jobs.map((j) => j.id));

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
      effectiveSortKey !== "job_desc" ||
      yearParam === "all" ||
      (yearParam && /^\d{4}$/.test(yearParam) && parseInt(yearParam, 10) !== preferredY) ||
      signedUndated ||
      signedMonthFilter !== undefined
  );

  const tableRows: JobsTableRowDTO[] = jobs.map((j) => {
    const cx = commByJob.get(j.id);
    const contractAmount = j.contractAmount.toNumber();
    const changeOrders = j.changeOrders.toNumber();
    const invoicedTotal = j.invoicedTotal.toNumber();
    const amountPaid = j.amountPaid?.toNumber() ?? null;
    const gp = canSeeGp ? j.gp.toNumber() : 0;
    const cost = j.cost.toNumber();
    const revenue = contractAmount + changeOrders;
    const derivedGpMargin = canSeeGp ? marginPctForJob(revenue, cost, gp) : null;
    const insuranceJob = isInsuranceCustomerName(j.name);
    const retailPercent = derivedGpMargin != null && !insuranceJob ? derivedGpMargin : null;
    const insurancePercent = derivedGpMargin != null && insuranceJob ? derivedGpMargin : null;
    const paidInFullDerived =
      j.paidInFull ||
      looksPaidAndClosedStatus(j.status) ||
      (amountPaid != null && invoicedTotal > MONEY_EPSILON && Math.abs(amountPaid - invoicedTotal) <= MONEY_EPSILON);
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
      contractAmount,
      changeOrders,
      invoicedTotal,
      amountPaid,
      paidDate: j.paidDate ? j.paidDate.toISOString() : null,
      retailPercent,
      insurancePercent,
      cost,
      paidInFull: paidInFullDerived,
      gp,
      gpPercent: canSeeGp ? j.gpPercent.toNumber() : 0,
      projectRevenue: canSeeGp ? j.projectRevenue.toNumber() : 0,
      commPaid: cx ? cx.paid : null,
      commOwed: cx ? cx.owed : null,
      quoteLinks: quoteLinksByJob.get(j.id) ?? [],
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
          {user.role === "SUPER_ADMIN" ? (
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
            Status
            <select name="status" defaultValue={status || ""} style={{ minWidth: 180 }}>
              <option value="">All</option>
              {statusOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort
            <select name="sort" defaultValue={sortKey} style={{ minWidth: 230 }}>
              <option value="job_desc">Job # newest first (high → low)</option>
              <option value="job_asc">Job # oldest first (low → high)</option>
              <option value="amount_paid_desc">Amount paid high → low</option>
              <option value="amount_paid_asc">Amount paid low → high</option>
              <option value="contract_desc">Contract amount high → low</option>
              <option value="contract_asc">Contract amount low → high</option>
              <option value="invoiced_desc">Invoiced total high → low</option>
              <option value="invoiced_asc">Invoiced total low → high</option>
              {canSeeGp ? <option value="gp_desc">GP high → low</option> : null}
              {canSeeGp ? <option value="gp_asc">GP low → high</option> : null}
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
        {hasFilters ? " match filters" : ""} · sort{" "}
        {effectiveSortKey === "job_desc"
          ? "job # newest first"
          : effectiveSortKey === "job_asc"
            ? "job # oldest first"
            : effectiveSortKey === "amount_paid_desc"
              ? "amount paid high to low"
              : effectiveSortKey === "amount_paid_asc"
                ? "amount paid low to high"
                : effectiveSortKey === "contract_desc"
                  ? "contract amount high to low"
                  : effectiveSortKey === "contract_asc"
                    ? "contract amount low to high"
                    : effectiveSortKey === "invoiced_desc"
                      ? "invoiced total high to low"
                      : effectiveSortKey === "invoiced_asc"
                        ? "invoiced total low to high"
                        : effectiveSortKey === "gp_desc"
                          ? "gp high to low"
                          : "gp low to high"}
        <span style={{ display: "block", marginTop: "0.35rem", fontSize: "0.82rem" }}>
          Commission columns = <strong>all reps</strong> on that job (incl. manager lines).
        </span>
      </p>

      <JobsTableSection rows={tableRows} user={user} statusBadgeColors={statusBadgeColors} statusOptions={statusOptions} />
    </div>
  );
}
