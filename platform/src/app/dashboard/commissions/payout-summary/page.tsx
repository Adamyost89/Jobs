import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canModifyData, canViewAllJobs } from "@/lib/rbac";
import { formatDateInEastern } from "@/lib/payout-display";
import { distinctPayoutYearsForSelect, loadPayoutSummary } from "@/lib/payout-summary";
import { PayPeriodAllRepsTable } from "@/components/PayPeriodAllRepsTable";
import { defaultDashboardYear, parseWorkYearQuery } from "@/lib/work-year";
import Link from "next/link";

type Search = { year?: string };

function pickString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function PayoutSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await getSession();
  if (!user) return null;
  const canManagePayoutLines = canModifyData(user);

  const sp = await searchParams;
  const yearParamRaw = pickString(sp.year);
  const preferredY = defaultDashboardYear();
  const { yearInt, yearSelectDefault } = parseWorkYearQuery(yearParamRaw, {
    defaultYearInt: preferredY,
    defaultYearSelect: String(preferredY),
  });
  const curY = preferredY;
  const salespersonIds = !canViewAllJobs(user) ? user.salespersonIds : undefined;
  const yearOptsSet = new Set(await distinctPayoutYearsForSelect(prisma, { salespersonIds }));
  if (yearSelectDefault !== "all") {
    const n = parseInt(yearSelectDefault, 10);
    if (!Number.isNaN(n)) yearOptsSet.add(n);
  }
  const yearOpts = [...yearOptsSet].sort((a, b) => b - a);

  const { byWindow, byRep } = await loadPayoutSummary(prisma, {
    yearInt,
    salespersonIds,
  });

  const payPeriodAllRepsRows = byWindow.map((w) => ({
    key: `${w.payPeriodLabel}|${w.lastPosted.toISOString()}`,
    payPeriodLabel: formatDateInEastern(w.periodSortDate),
    count: w.count,
    total: w.total,
    lastPostedLabel: formatDateInEastern(w.lastPosted),
    periodSortAt: w.periodSortDate.toISOString(),
    lastPostedAt: w.lastPosted.toISOString(),
    lines: w.lines.map((l) => ({
      id: l.id,
      amount: l.amount,
      salespersonName: l.salespersonName,
      jobNumber: l.jobNumber,
      jobName: l.jobName,
      jobYear: l.jobYear,
      notes: l.notes,
      postedLabel: formatDateInEastern(l.createdAt),
    })),
  }));
  const grandTotalPaid = byWindow.reduce((sum, w) => sum + w.total, 0);
  const grandTotalLabel = yearInt === null ? "all years" : String(yearInt);

  const money2 = (n: number) =>
    n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div className="page-stack page-stack--full">
      <div className="page-title-row">
        <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750, letterSpacing: "-0.02em" }}>Payout summary</h1>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)", maxWidth: 480 }}>
          Posted check totals by pay window (same data as the payroll log, rolled up).
        </p>
      </div>

      <form method="get" className="card" style={{ padding: "1rem 1.15rem" }}>
        <div className="filter-bar">
          <label>
            Payout year (posted date)
            <select name="year" defaultValue={yearSelectDefault} style={{ minWidth: 160 }}>
              {yearOpts.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
              <option value="all">All years</option>
            </select>
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" type="submit">
              Apply
            </button>
            <a href="/dashboard/commissions/payout-summary" className="btn secondary" style={{ textDecoration: "none" }}>
              Reset
            </a>
          </div>
        </div>
      </form>

      <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.5 }}>
        Totals are from <strong>posted commission checks</strong> in the app (same as the payment history on each job).
        Dates use <strong>Eastern</strong> time. Default payout year is <strong>{preferredY}</strong> (calendar {curY}) —
        change the filter to match the year you&apos;re closing payroll for.
      </p>

      {byWindow.length === 0 ? (
        <p className="card" style={{ margin: 0, color: "var(--muted)" }}>
          No payout rows for this filter yet.
        </p>
      ) : (
        <div className="card" style={{ display: "grid", gap: "0.85rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>By paycheck date (all reps combined)</h2>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
            Click a row to expand and see every posted payout line in that check bucket.
          </p>
          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            <strong>Grand total paid ({grandTotalLabel}):</strong> {money2(grandTotalPaid)}
          </p>
          <PayPeriodAllRepsTable rows={payPeriodAllRepsRows} canManagePayoutLines={canManagePayoutLines} />

          <h2 style={{ margin: "0.5rem 0 0", fontSize: "1.1rem", fontWeight: 700 }}>By salesperson &amp; paycheck date</h2>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Paycheck date</th>
                  <th>Salesperson</th>
                  <th className="cell-num"># checks</th>
                  <th className="cell-num">Total</th>
                  <th>Last posted</th>
                </tr>
              </thead>
              <tbody>
                {byRep.map((s) => (
                  <tr key={`${s.payPeriodLabel}|${s.salespersonName}`}>
                    <td>{formatDateInEastern(s.periodSortDate)}</td>
                    <td className="cell-nowrap">{s.salespersonName}</td>
                    <td className="cell-num">{s.count}</td>
                    <td className="cell-num">{money2(s.total)}</td>
                    <td className="cell-muted" style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>
                      {formatDateInEastern(s.lastPosted)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
