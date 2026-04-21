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
  const jobWhere: Prisma.JobWhereInput = { year: workYear };
  if (!canSeeGp) {
    jobWhere.salespersonId = user.salespersonId ?? "__none__";
  }

  const { rows: amRows, grand } = await loadAmSummaryForYear(prisma, jobWhere);

  const money2 = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let monthly: SignedContractsAnalytics | null = null;
  if (user.role !== Role.HR) {
    const m = await getSignedContractsAnalytics(user, { summaryYear: workYear, monthlyYear: workYear });
    if (!("error" in m)) monthly = m;
  }

  return (
    <div className="page-stack">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "0.75rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750, letterSpacing: "-0.02em" }}>Home</h1>
        <form method="get" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
            Year
            <select name="year" defaultValue={String(workYear)} style={{ marginLeft: "0.35rem", minWidth: 100 }}>
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
          Click a rep row to open their jobs for {workYear}.
        </p>
        <table className="table table-data" style={{ fontSize: "0.88rem" }}>
          <thead>
            <tr>
              <th>AM</th>
              <th className="cell-num">#</th>
              <th className="cell-num">Contract</th>
              <th className="cell-num">Change orders</th>
              <th className="cell-num">Total</th>
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
                href={jobsDrilldownUrl({ year: workYear, salespersonId: r.salespersonId ?? undefined })}
              >
                <td className="cell-strong">{r.name}</td>
                <td className="cell-num">{r.jobCount}</td>
                <td className="cell-num">{money2(r.contractAmt)}</td>
                <td className="cell-num">{money2(r.changeOrders)}</td>
                <td className="cell-num">{money2(r.total)}</td>
                {canSeeGp ? <td className="cell-num">{money2(r.gp)}</td> : null}
                {canSeeGp ? <td className="cell-num">{formatPctOrDash(r.retailPct)}</td> : null}
                {canSeeGp ? <td className="cell-num">{formatPctOrDash(r.insurancePct)}</td> : null}
                {canSeeGp ? <td className="cell-num">{formatPctOrDash(r.gpPctOfTotal)}</td> : null}
                <td className="cell-num">{money2(r.avgPerContract)}</td>
                <td className="cell-num">{r.openJobs}</td>
              </DrilldownTableRow>
            ))}
            <tr style={{ fontWeight: 700, background: "var(--card-border, rgba(0,0,0,0.06))" }}>
              <td>Grand total</td>
              <td className="cell-num">{grand.jobCount}</td>
              <td className="cell-num">{money2(grand.contractAmt)}</td>
              <td className="cell-num">{money2(grand.changeOrders)}</td>
              <td className="cell-num">{money2(grand.total)}</td>
              {canSeeGp ? <td className="cell-num">{money2(grand.gp)}</td> : null}
              {canSeeGp ? <td className="cell-num">{formatPctOrDash(grand.retailPct)}</td> : null}
              {canSeeGp ? <td className="cell-num">{formatPctOrDash(grand.insurancePct)}</td> : null}
              {canSeeGp ? <td className="cell-num">{formatPctOrDash(grand.gpPctOfTotal)}</td> : null}
              <td className="cell-num">{money2(grand.avgPerContract)}</td>
              <td className="cell-num">{grand.openJobs}</td>
            </tr>
          </tbody>
        </table>
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
            salespersonIdByRepName={monthly.salespersonIdByRepName}
          />
        </div>
      )}

    </div>
  );
}
