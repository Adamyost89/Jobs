import { redirect } from "next/navigation";
import Link from "next/link";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canViewHrPayroll } from "@/lib/rbac";
import { formatDateTimeInEastern } from "@/lib/payout-display";
import { commissionDisplayAmounts } from "@/lib/commission-display";
import { CommissionSubnav } from "@/components/CommissionSubnav";
import { displaySalespersonName } from "@/lib/salesperson-name";

export default async function HrCommissionsPayrollPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!canViewHrPayroll(user)) redirect("/dashboard");

  const candidates = await prisma.commission.findMany({
    where: { override: false, owedAmount: { gt: 0 }, salesperson: { active: true } },
    include: {
      job: { select: { jobNumber: true, name: true, year: true, leadNumber: true } },
      salesperson: { select: { name: true, active: true } },
    },
  });

  const pairKeys = [...new Set(candidates.map((c) => `${c.jobId}|${c.salespersonId}`))];
  const orClause = pairKeys.map((k) => {
    const [jobId, salespersonId] = k.split("|");
    return { jobId, salespersonId };
  });

  const payoutSums =
    orClause.length === 0
      ? []
      : await prisma.commissionPayout.findMany({
          where: { OR: orClause },
          select: { jobId: true, salespersonId: true, amount: true },
        });

  const sumMap = new Map<string, number>();
  for (const p of payoutSums) {
    if (!p.jobId) continue;
    const k = `${p.jobId}|${p.salespersonId}`;
    sumMap.set(k, (sumMap.get(k) ?? 0) + p.amount.toNumber());
  }

  const rowsWithDisplay = candidates
    .map((c) => {
      const key = `${c.jobId}|${c.salespersonId}`;
      const sm = sumMap.get(key) ?? 0;
      const { displayOwed } = commissionDisplayAmounts(
        c.paidAmount.toNumber(),
        c.owedAmount.toNumber(),
        sm,
        c.salesperson.active
      );
      return { c, displayOwed };
    })
    .filter((r) => r.displayOwed > 0.005)
    .sort((a, b) => b.displayOwed - a.displayOwed)
    .slice(0, 500);

  const owedBySp = new Map<string, number>();
  let totalOwed = 0;
  for (const { c, displayOwed } of rowsWithDisplay) {
    totalOwed += displayOwed;
    const k = displaySalespersonName(c.salesperson.name);
    owedBySp.set(k, (owedBySp.get(k) ?? 0) + displayOwed);
  }
  const owedSpLines = [...owedBySp.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, amt]) => `${name}: ${amt.toLocaleString(undefined, { style: "currency", currency: "USD" })}`)
    .join(" · ");

  const payouts = await prisma.commissionPayout.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 5000,
    include: {
      salesperson: { select: { name: true } },
      job: { select: { jobNumber: true, name: true, year: true } },
    },
  });

  const byPeriod = new Map<string, typeof payouts>();
  for (const p of payouts) {
    const k = p.payPeriodLabel;
    if (!byPeriod.has(k)) byPeriod.set(k, []);
    byPeriod.get(k)!.push(p);
  }

  const periods = [...byPeriod.entries()].sort((a, b) => {
    const ta = Math.max(...a[1].map((x) => x.createdAt.getTime()));
    const tb = Math.max(...b[1].map((x) => x.createdAt.getTime()));
    return tb - ta;
  });

  const grandTotal = payouts.reduce((s, p) => s + p.amount.toNumber(), 0);

  return (
    <div className="page-stack" style={{ gap: "1.25rem" }}>
      <CommissionSubnav showPayroll />
      <div>
        <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750 }}>HR · Commissions</h1>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem", color: "var(--muted)", maxWidth: 720, lineHeight: 1.5 }}>
          <strong>Still due</strong> uses the same math as{" "}
          <Link href="/dashboard/commissions">Commission lines</Link> (all job years, ledger + posted checks).{" "}
          <strong>Payroll log</strong> = checks by pay period. Run{" "}
          <code>npm run sync:commission-ledger-from-payouts</code> once if you want the database columns to match too.
        </p>
      </div>

      <section className="card" style={{ display: "grid", gap: "0.75rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.5rem", alignItems: "baseline" }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Still due (commission not yet paid)</h2>
          <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>
            Total:{" "}
            {totalOwed.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 })}
          </div>
        </div>
        {owedSpLines ? (
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>By rep: {owedSpLines}</p>
        ) : null}
        {rowsWithDisplay.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)" }}>Nothing outstanding after reconciling checks with the ledger.</p>
        ) : (
          <div>
            <table className="table table-data">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th>Job</th>
                  <th>Year</th>
                  <th>Lead</th>
                  <th>Customer</th>
                  <th className="cell-num">Still owed</th>
                </tr>
              </thead>
              <tbody>
                {rowsWithDisplay.map(({ c, displayOwed }) => (
                  <tr key={c.id}>
                    <td className="cell-nowrap">{displaySalespersonName(c.salesperson.name)}</td>
                    <td className="job-cell-num">
                      <Link
                        href={jobsDrilldownUrl({ year: c.job.year, q: c.job.jobNumber })}
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        {c.job.jobNumber}
                      </Link>
                    </td>
                    <td>{c.job.year}</td>
                    <td>{c.job.leadNumber ?? "—"}</td>
                    <td style={{ maxWidth: 220 }}>{c.job.name?.trim() || "—"}</td>
                    <td className="cell-num cell-strong">
                      {displayOwed.toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
          Admins post payments from <Link href="/dashboard/commissions">Commission lines</Link>. Override rows are excluded here.
        </p>
      </section>

      <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Posted checks by pay period</h2>
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
        <div style={{ fontSize: "0.95rem" }}>
          <strong>{payouts.length}</strong> payout line{payouts.length === 1 ? "" : "s"} ·{" "}
          <strong>${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>{" "}
          total
        </div>
        <a className="btn secondary" href="/api/reports/payroll-payouts" style={{ textDecoration: "none" }}>
          Download CSV (all lines)
        </a>
      </div>

      {periods.length === 0 ? (
        <p className="card" style={{ margin: 0, color: "var(--muted)" }}>
          No payout rows yet. Run <code>npm run import:payouts</code> after placing <code>Commissions.xlsx</code> at the
          repo root, or post payments from Commission lines.
        </p>
      ) : (
        periods.map(([periodLabel, lines]) => {
          const periodTotal = lines.reduce((s, p) => s + p.amount.toNumber(), 0);
          const bySp = new Map<string, number>();
          for (const p of lines) {
            const n = displaySalespersonName(p.salesperson.name);
            bySp.set(n, (bySp.get(n) ?? 0) + p.amount.toNumber());
          }
          const spSummary = [...bySp.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([n, amt]) => `${n}: $${amt.toFixed(2)}`)
            .join(" · ");

          return (
            <section key={periodLabel} className="card" style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.5rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.15rem" }}>{periodLabel}</h2>
                <div style={{ fontWeight: 700 }}>
                  Period total: ${periodTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>{spSummary}</p>
              <div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Salesperson</th>
                      <th>Amount</th>
                      <th>Job</th>
                      <th>Year</th>
                      <th>Customer / notes</th>
                      <th>Posted</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...lines]
                      .sort((a, b) =>
                        displaySalespersonName(a.salesperson.name).localeCompare(
                          displaySalespersonName(b.salesperson.name)
                        )
                      )
                      .map((p) => (
                        <tr key={p.id}>
                          <td>{displaySalespersonName(p.salesperson.name)}</td>
                          <td>${p.amount.toNumber().toFixed(2)}</td>
                          <td>
                            {p.job?.jobNumber ? (
                              <Link
                                href={jobsDrilldownUrl({
                                  year: p.job.year,
                                  q: p.job.jobNumber,
                                })}
                                style={{ color: "inherit", textDecoration: "none" }}
                              >
                                {p.job.jobNumber}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{p.job?.year ?? "—"}</td>
                          <td style={{ maxWidth: 280, fontSize: "0.9rem" }}>
                            {p.job?.name ? <>{p.job.name}</> : null}
                            {p.notes ? (
                              <span style={{ color: "var(--muted)" }}>
                                {p.job?.name ? " · " : ""}
                                {p.notes}
                              </span>
                            ) : null}
                          </td>
                          <td style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>
                            {formatDateTimeInEastern(p.createdAt)}
                          </td>
                          <td style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                            {p.importSourceKey ? "Excel import" : "In-app"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
        Which legacy tabs map into the database (jobs, commissions, payout log, Drew file) is summarized under
        &quot;Software coverage&quot; in <code>docs/workbook-inventory.md</code>.
      </p>
    </div>
  );
}
