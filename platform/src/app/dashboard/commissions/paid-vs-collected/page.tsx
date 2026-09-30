import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canViewHrPayroll } from "@/lib/rbac";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";
import { loadRepPaidVsCollected } from "@/lib/rep-paid-vs-collected";
import { defaultDashboardYear, distinctJobYearsForSelect, parseWorkYearQuery } from "@/lib/work-year";

type Search = { year?: string };

function pickString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

const money2 = (n: number) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const pct = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`);

export default async function PaidVsCollectedPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await getSession();
  if (!user) return null;

  const sp = await searchParams;
  const preferredY = defaultDashboardYear();
  const { yearInt, yearSelectDefault } = parseWorkYearQuery(pickString(sp.year), {
    defaultYearInt: preferredY,
    defaultYearSelect: String(preferredY),
  });
  const yearOpts = await distinctJobYearsForSelect(prisma);

  const seesAllReps = canViewHrPayroll(user);
  const salespersonIds = seesAllReps ? undefined : user.salespersonIds;
  const { rows, totals } =
    salespersonIds && salespersonIds.length === 0
      ? { rows: [], totals: { collected: 0, commissionPaid: 0, commissionOwed: 0 } }
      : await loadRepPaidVsCollected(prisma, { yearInt, salespersonIds });
  const yearLabel = yearInt === undefined ? "all years" : String(yearInt);

  return (
    <div className="page-stack page-stack--full">
      <div className="page-title-row">
        <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750, letterSpacing: "-0.02em" }}>
          Commission paid vs collected
        </h1>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)", maxWidth: 480 }}>
          Per rep: customer cash collected on their jobs next to commission paid and still owed.
        </p>
      </div>

      <form method="get" className="card" style={{ padding: "1rem 1.15rem" }}>
        <div className="filter-bar">
          <label>
            Job year
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
            <a href="/dashboard/commissions/paid-vs-collected" className="btn secondary" style={{ textDecoration: "none" }}>
              Reset
            </a>
          </div>
        </div>
      </form>

      <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.5 }}>
        <strong>Collected</strong> is the job&apos;s Amount Paid (net of merchant fees for ProLine payments) on jobs the
        rep sold or earns commission on, so managers include every job they&apos;re paid on. <strong>Commission paid</strong>{" "}
        matches <Link href="/dashboard/commissions">Commission lines</Link> (ledger reconciled with posted checks).
        Filtered by job year; checks not linked to a job use their payout year.
      </p>

      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Collected ({yearLabel})</div>
          <div style={{ fontWeight: 800, fontSize: "1.2rem" }}>{money2(totals.collected)}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Commission paid</div>
          <div style={{ fontWeight: 800, fontSize: "1.2rem" }}>{money2(totals.commissionPaid)}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Commission still owed</div>
          <div style={{ fontWeight: 800, fontSize: "1.2rem" }}>{money2(totals.commissionOwed)}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="card" style={{ margin: 0, color: "var(--muted)" }}>
          No collections or commissions for this filter yet.
        </p>
      ) : (
        <div className="card" style={{ display: "grid", gap: "0.85rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>By rep</h2>
          <div className="table-responsive">
            <table className="table table-data">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th className="cell-num">Jobs</th>
                  <th className="cell-num">Collected</th>
                  <th className="cell-num">Commission paid</th>
                  <th className="cell-num">Still owed</th>
                  <th className="cell-num">Paid % of collected</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td className="cell-nowrap cell-strong">{r.name}</td>
                    <td className="cell-num">{r.jobCount}</td>
                    <td className="cell-num">{money2(r.collected)}</td>
                    <td className="cell-num">{money2(r.commissionPaid)}</td>
                    <td className="cell-num">{money2(r.commissionOwed)}</td>
                    <td className="cell-num">{pct(r.paidPctOfCollected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ margin: "0.5rem 0 0", fontSize: "1.1rem", fontWeight: 700 }}>Job detail by rep</h2>
          {rows.map((r) => (
            <details key={`detail-${r.name}`} className="card" style={{ padding: "0.6rem 0.9rem" }}>
              <summary style={{ cursor: "pointer", fontWeight: 650 }}>
                {r.name} · {money2(r.collected)} collected · {money2(r.commissionPaid)} paid
              </summary>
              <div className="table-responsive" style={{ marginTop: "0.6rem" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Year</th>
                      <th>Customer</th>
                      <th className="cell-num">Collected</th>
                      <th className="cell-num">Commission paid</th>
                      <th className="cell-num">Still owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.jobs.map((j) => (
                      <tr key={j.jobId ?? "unlinked"}>
                        <td className="cell-nowrap">
                          {j.jobNumber ? (
                            <Link
                              href={jobsDrilldownUrl({ year: j.jobYear ?? undefined, q: j.jobNumber })}
                              style={{ color: "inherit" }}
                            >
                              {j.jobNumber}
                            </Link>
                          ) : (
                            "—"
                          )}
                          {j.jobId && !j.isPrimary ? (
                            <span className="cell-muted" style={{ fontSize: "0.78rem", marginLeft: 6 }}>
                              (not primary rep)
                            </span>
                          ) : null}
                        </td>
                        <td>{j.jobYear ?? "—"}</td>
                        <td style={{ maxWidth: 260 }}>{j.jobName?.trim() || "—"}</td>
                        <td className="cell-num">{money2(j.collected)}</td>
                        <td className="cell-num">{money2(j.commissionPaid)}</td>
                        <td className="cell-num">{money2(j.commissionOwed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
