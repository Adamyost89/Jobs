import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { Role } from "@prisma/client";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import {
  defaultDashboardYear,
  distinctJobYearsForSelect,
  parseWorkYearQuery,
  preferredDashboardJobYear,
} from "@/lib/work-year";
import { canViewAllJobs } from "@/lib/rbac";
import { loadAmSummaryForYear, formatPctOrDash } from "@/lib/am-summary";
import {
  getSignedContractsAnalytics,
  type SignedContractsAnalytics,
} from "@/lib/report-analytics";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";
import { DrilldownTableRow } from "@/components/DrilldownTableRow";
import { SignedMonthlyDrillGrid } from "@/components/SignedMonthlyDrillGrid";

function pickYear(sp: { year?: string | string[] } | undefined): string | undefined {
  const y = sp?.year;
  if (y === undefined) return undefined;
  return Array.isArray(y) ? y[0] : y;
}

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[] }>;
}) {
  const user = await getSession();
  if (!user) return null;

  const sp = await searchParams;
  const yearParamRaw = pickYear(sp);
  const preferredY = await preferredDashboardJobYear(prisma);
  const { yearInt, yearSelectDefault } = parseWorkYearQuery(yearParamRaw, {
    defaultYearInt: preferredY,
    defaultYearSelect: String(preferredY),
  });
  const workYear = yearInt ?? preferredY;
  const calendarY = defaultDashboardYear();

  const yearOptsSet = new Set(await distinctJobYearsForSelect(prisma));
  yearOptsSet.add(workYear);
  const yearOpts = [...yearOptsSet].sort((a, b) => b - a);

  const canSeeGp = canViewAllJobs(user);
  const companyWhere: Prisma.JobWhereInput = { year: workYear };
  const jobWhere: Prisma.JobWhereInput = { year: workYear };
  if (!canSeeGp) {
    jobWhere.salespersonId =
      user.salespersonIds.length > 0 ? { in: user.salespersonIds } : "__none__";
  }

  const { rows: amRows, grand } = await loadAmSummaryForYear(prisma, jobWhere);
  const companyGrand = canSeeGp ? grand : (await loadAmSummaryForYear(prisma, companyWhere)).grand;

  const money2 = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let monthly: SignedContractsAnalytics | null = null;
  if (user.role !== Role.HR) {
    const m = await getSignedContractsAnalytics(user, { summaryYear: workYear, monthlyYear: workYear });
    if (!("error" in m)) monthly = m;
  }

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750, letterSpacing: "-0.02em" }}>Home</h1>
        <form method="get" className="page-actions-inline">
          <label style={{ fontSize: "0.88rem", color: "var(--muted)", display: "grid", gap: "0.2rem" }}>
            Year
            <select name="year" defaultValue={String(workYear)} style={{ minWidth: 100 }}>
              {yearOpts.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn">
            Apply
          </button>
        </form>
      </div>
      <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)", maxWidth: 720 }}>
        {!yearParamRaw ? (
          <>
            Showing <strong>{workYear}</strong> (default is current calendar year{" "}
            <strong>{calendarY}</strong>).
          </>
        ) : (
          <>
            Showing <strong>{workYear}</strong>.
          </>
        )}{" "}
        <Link href={`/dashboard/jobs?year=${workYear}`}>Open job list</Link> ·{" "}
        <Link href="/dashboard/advanced">Advanced</Link>
      </p>

      <div className="card" style={{ padding: "0.35rem 0 0.85rem" }}>
        <h2 style={{ margin: "0.65rem 1rem 0.5rem", fontSize: "1.05rem" }}>By account manager</h2>
        <p style={{ margin: "0 1rem 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
          {canSeeGp
            ? `Click a rep row to open their jobs for ${workYear}.`
            : `Your row shows your jobs only. Company totals below include all account managers for ${workYear}.`}
        </p>
        <div className="table-responsive">
          <table className="table table-data" style={{ fontSize: "0.88rem" }}>
            <thead>
              <tr>
                <th>AM</th>
                <th className="cell-num">#</th>
                <th className="cell-num">Contract</th>
                <th className="cell-num">Change orders</th>
                <th className="cell-num">Total</th>
                <th className="cell-num">Invoice paid</th>
                {canSeeGp ? <th className="cell-num">GP</th> : null}
                {canSeeGp ? <th className="cell-num">Retail %</th> : null}
                {canSeeGp ? <th className="cell-num">Insurance %</th> : null}
                {canSeeGp ? <th className="cell-num">GP %</th> : null}
                <th className="cell-num">Avg / contract</th>
                <th className="cell-num">Open jobs</th>
              </tr>
            </thead>
            <tbody>
              {amRows.map((r) => (
                <DrilldownTableRow
                  key={r.salespersonId ?? r.name}
                  href={jobsDrilldownUrl({
                    year: workYear,
                    salespersonId: r.salespersonId ?? undefined,
                    salespersonName: r.salespersonId ? undefined : r.name,
                  })}
                >
                  <td className="cell-strong">{r.name}</td>
                  <td className="cell-num">{r.jobCount}</td>
                  <td className="cell-num">{money2(r.contractAmt)}</td>
                  <td className="cell-num">{money2(r.changeOrders)}</td>
                  <td className="cell-num">{money2(r.total)}</td>
                  <td className="cell-num">{money2(r.paid)}</td>
                  {canSeeGp ? <td className="cell-num">{money2(r.gp)}</td> : null}
                  {canSeeGp ? <td className="cell-num">{formatPctOrDash(r.retailPct)}</td> : null}
                  {canSeeGp ? <td className="cell-num">{formatPctOrDash(r.insurancePct)}</td> : null}
                  {canSeeGp ? <td className="cell-num">{formatPctOrDash(r.gpPctOfTotal)}</td> : null}
                  <td className="cell-num">{money2(r.avgPerContract)}</td>
                  <td className="cell-num">{r.openJobs}</td>
                </DrilldownTableRow>
              ))}
              <tr style={{ fontWeight: 700, background: "var(--card-border, rgba(0,0,0,0.06))" }}>
                <td>{canSeeGp ? "Grand total" : "Company total"}</td>
                <td className="cell-num">{companyGrand.jobCount}</td>
                <td className="cell-num">{money2(companyGrand.contractAmt)}</td>
                <td className="cell-num">{money2(companyGrand.changeOrders)}</td>
                <td className="cell-num">{money2(companyGrand.total)}</td>
                <td className="cell-num">{money2(companyGrand.paid)}</td>
                {canSeeGp ? <td className="cell-num">{money2(companyGrand.gp)}</td> : null}
                {canSeeGp ? <td className="cell-num">{formatPctOrDash(companyGrand.retailPct)}</td> : null}
                {canSeeGp ? <td className="cell-num">{formatPctOrDash(companyGrand.insurancePct)}</td> : null}
                {canSeeGp ? <td className="cell-num">{formatPctOrDash(companyGrand.gpPctOfTotal)}</td> : null}
                <td className="cell-num">{money2(companyGrand.avgPerContract)}</td>
                <td className="cell-num">{companyGrand.openJobs}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {monthly && (
        <div className="card" style={{ padding: "0.35rem 0 0.85rem" }}>
          <h2 style={{ margin: "0.65rem 1rem 0.5rem", fontSize: "1.05rem" }}>Signed dollars by month ({workYear})</h2>
          {monthly.jobsUndatedNoSignDate > 0 ? (
            <p style={{ margin: "0 1rem 0.75rem", fontSize: "0.82rem", color: "var(--muted)", lineHeight: 1.45 }}>
              <strong>{monthly.jobsUndatedNoSignDate}</strong> job
              {monthly.jobsUndatedNoSignDate === 1 ? " has" : "s have"} no contract signed date — those dollars appear in
              the <strong>Undated</strong> row (not spread across months). Re-import after dates are filled in the sheet;
              empty date cells no longer clear a date already stored in the app.
            </p>
          ) : null}
          <p style={{ margin: "0 1rem 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
            Click a cell to open matching jobs (same filters as Reports).
          </p>
          <SignedMonthlyDrillGrid
            monthlyYear={workYear}
            monthlyTopRepNames={monthly.monthlyTopRepNames}
            monthlyStacked={monthly.monthlyStacked}
            monthlySignedCounts={monthly.monthlySignedCounts}
            salespersonIdByRepName={monthly.salespersonIdByRepName}
          />
        </div>
      )}

    </div>
  );
}
