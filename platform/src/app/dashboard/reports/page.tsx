import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canRunFullReports, canViewHrPayroll } from "@/lib/rbac";
import { preferredDashboardJobYear } from "@/lib/work-year";
import Link from "next/link";
import { ReportsAnalyticsDashboard } from "@/components/reports/ReportsAnalyticsDashboard";
import { FinancialMetricsDashboard } from "@/components/reports/FinancialMetricsDashboard";

export default async function ReportsPage() {
  const user = await getSession();
  if (!user) return null;

  const defaultYear = await preferredDashboardJobYear(prisma);
  const showSignedDashboard = canRunFullReports(user) || !!user.salespersonId;

  return (
    <div className="page-stack">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.5rem 1rem" }}>
        <h1 style={{ margin: 0 }}>Reports</h1>
        <span style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
          Visual summaries plus CSV / JSON exports
        </span>
      </div>

      {showSignedDashboard && (
        <>
          <ReportsAnalyticsDashboard defaultYear={defaultYear} />
          <FinancialMetricsDashboard defaultYear={defaultYear} />
        </>
      )}

      {canViewHrPayroll(user) && (
        <div className="card" style={{ display: "grid", gap: "0.5rem" }}>
          <h2 style={{ margin: 0, fontSize: "1rem" }}>Payroll</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
            Commission check register (by pay period):{" "}
            <Link href="/dashboard/hr/commissions">Payroll</Link> · CSV{" "}
            <a href="/api/reports/payroll-payouts">/api/reports/payroll-payouts</a>
          </p>
        </div>
      )}

      <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
        <h2 style={{ margin: 0, fontSize: "1rem" }}>Exports &amp; APIs</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a className="btn" href="/api/reports/export?scope=mine">
            Export my jobs (CSV)
          </a>
          {canRunFullReports(user) && (
            <a className="btn secondary" href="/api/reports/export?scope=full">
              Export all jobs (CSV)
            </a>
          )}
        </div>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
          JSON endpoints default to the <strong>current calendar year</strong> (same as Home) when <code>?year</code> is
          omitted; add <code>?year=all</code> for lifetime totals (includes archive years).
        </p>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
          <Link href="/api/reports/salesman">/api/reports/salesman</Link> (salesman) ·{" "}
          <Link href="/api/reports/salesman?year=all">…?year=all</Link>
          {" · "}
          <Link href="/api/reports/company">/api/reports/company</Link> (role-filtered) ·{" "}
          <Link href="/api/reports/company?year=all">…?year=all</Link>
          {" · "}
          <Link href="/api/reports/analytics">/api/reports/analytics</Link> (signed-contracts dashboard data)
          {" · "}
          <Link href="/api/reports/financial-metrics">/api/reports/financial-metrics</Link> (cost / GP / invoicing trends;
          add <code>?summaryYear=YYYY</code>, <code>?jobNumber=…</code> for per-job cost edit history)
        </p>
      </div>
    </div>
  );
}
