import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canViewAllJobs, canMarkCommissionPaid, canEditCommissions } from "@/lib/rbac";
import { PayCommissionForm } from "@/components/PayCommissionForm";
import { CommissionLineAdminForm } from "@/components/CommissionLineAdminForm";
import { formatIsoDateForPayrollTz, getPayPeriodForPayday, parseIsoDateAtNoonUtc } from "@/lib/pay-period";
import { formatDateInEastern } from "@/lib/payout-display";
import Link from "next/link";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";
import type { Prisma } from "@prisma/client";
import { commissionDisplayAmounts, roundMoney } from "@/lib/commission-display";
import { jobNumberSortKey } from "@/lib/job-sort";
import { displaySalespersonName } from "@/lib/salesperson-name";
import { CommissionExplainButton } from "@/components/CommissionExplainButton";

function parsePaydayParam(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const t = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const user = await getSession();
  if (!user) return null;
  const showCalcTrace = user.role === "SUPER_ADMIN";

  const todayIso = formatIsoDateForPayrollTz(new Date());
  const selectedPaydayIso = parsePaydayParam(sp.payday) ?? todayIso;
  const selectedPaydayDate = parseIsoDateAtNoonUtc(selectedPaydayIso) ?? new Date();
  const suggestedPayPeriod = getPayPeriodForPayday(selectedPaydayDate).label;

  const parts: Prisma.CommissionWhereInput[] = [];
  parts.push({ owedAmount: { gt: 0 } });
  if (!canViewAllJobs(user)) {
    parts.push(
      user.salespersonIds.length > 0
        ? { salespersonId: { in: user.salespersonIds } }
        : { id: "__none__" }
    );
  }
  const where: Prisma.CommissionWhereInput =
    parts.length === 0 ? {} : parts.length === 1 ? parts[0]! : { AND: parts };

  const rows = await prisma.commission.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      job: { select: { jobNumber: true, name: true, year: true, leadNumber: true } },
      salesperson: { select: { name: true, active: true } },
    },
  });

  const pairKeys = [...new Set(rows.map((c) => `${c.jobId}|${c.salespersonId}`))];
  const orClause = pairKeys.map((k) => {
    const [jobId, salespersonId] = k.split("|");
    return { jobId, salespersonId };
  });

  const payouts =
    orClause.length === 0
      ? []
      : await prisma.commissionPayout.findMany({
          where: { OR: orClause },
          orderBy: { createdAt: "desc" },
          include: { salesperson: true, job: { select: { jobNumber: true } } },
        });

  const payoutLines = new Map<string, typeof payouts>();
  for (const p of payouts) {
    if (!p.jobId) continue;
    const k = `${p.jobId}|${p.salespersonId}`;
    if (!payoutLines.has(k)) payoutLines.set(k, []);
    payoutLines.get(k)!.push(p);
  }

  function sumPayoutsForKey(key: string): number {
    return (payoutLines.get(key) ?? []).reduce((s, p) => s + p.amount.toNumber(), 0);
  }

  type RowModel = {
    c: (typeof rows)[number];
    key: string;
    lines: typeof payouts;
    linesAllLen: number;
    displayPaid: number;
    displayOwed: number;
    payoutSum: number;
    sub: string | null;
    rowHl: string;
  };

  const rowModelsAll: RowModel[] = rows.map((c) => {
    const key = `${c.jobId}|${c.salespersonId}`;
    const fullLines = payoutLines.get(key) ?? [];
    const lines = fullLines.slice(0, 15);
    const linesAllLen = fullLines.length;
    const payoutSum = sumPayoutsForKey(key);
    const { displayPaid, displayOwed } = commissionDisplayAmounts(
      c.paidAmount.toNumber(),
      c.owedAmount.toNumber(),
      payoutSum,
      c.salesperson.active
    );
    const sub =
      [c.job.leadNumber ? `Lead ${c.job.leadNumber}` : null, c.job.name?.trim() || null]
        .filter(Boolean)
        .join(" · ") || null;
    const rowHl =
      c.override
        ? "row-hl row-hl--warn"
        : displayOwed >= 25_000
          ? "row-hl row-hl--bad"
          : displayOwed > 0
            ? "row-hl row-hl--warn"
            : "";
    return { c, key, lines, linesAllLen, displayPaid, displayOwed, payoutSum, sub, rowHl };
  });

  const rowModels = rowModelsAll
    .filter((m) => roundMoney(m.displayOwed) > 0.005)
    .sort((a, b) => {
      const jnA = a.c.job.jobNumber;
      const jnB = b.c.job.jobNumber;
      const d = jobNumberSortKey(jnA) - jobNumberSortKey(jnB);
      if (d !== 0) return d;
      const s = jnA.localeCompare(jnB);
      if (s !== 0) return s;
      return a.c.salespersonId.localeCompare(b.c.salespersonId);
    });

  const money2 = (n: number) =>
    n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div className="page-stack page-stack--full">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.75rem",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 750, letterSpacing: "-0.02em" }}>Commission lines</h1>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)", maxWidth: 520 }}>
          Outstanding balances only (all job years). Full payout rollups:{" "}
          <Link href="/dashboard/commissions/payout-summary">Payout rollups</Link>
        </p>
      </div>

      {canMarkCommissionPaid(user) ? (
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
          Payday default when posting: <code>{selectedPaydayIso}</code> (pay period: <code>{suggestedPayPeriod}</code>)
        </p>
      ) : null}
      {canMarkCommissionPaid(user) ? (
        <form method="GET" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <label htmlFor="payday" style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
            Payday for all lines:
          </label>
          <input
            id="payday"
            name="payday"
            type="date"
            defaultValue={selectedPaydayIso}
            style={{
              padding: "0.4rem 0.55rem",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "var(--text)",
              fontSize: "0.82rem",
            }}
          />
          <button className="btn" type="submit" style={{ fontSize: "0.82rem" }}>
            Set payday
          </button>
          <Link className="btn btn-ghost" href="/dashboard/commissions" style={{ fontSize: "0.82rem" }}>
            Reset to today
          </Link>
        </form>
      ) : null}
      {canEditCommissions(user) ? (
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)", maxWidth: 720 }}>
          <strong>Admins:</strong> If someone should not earn on a job, set <strong>Admin correction</strong> to{" "}
          <code>$0</code> and click <strong>Adjust &amp; lock</strong>. Use this for one-off corrections without changing the
          underlying job row.
        </p>
      ) : null}

      <div className="card" style={{ padding: "0.35rem 0 0.85rem" }}>
        <table className="table table-data">
          <thead>
            <tr>
              <th>Job</th>
              <th>Salesperson</th>
              <th className="cell-num">Paid (ledger + checks)</th>
              <th className="cell-num">Still owed</th>
              <th style={{ minWidth: "15rem" }}>Payment history</th>
              {showCalcTrace && <th style={{ minWidth: "18rem" }}>Calc trace</th>}
              <th>Lock</th>
              {canMarkCommissionPaid(user) && <th style={{ minWidth: "13rem" }}>Post payment</th>}
              {canEditCommissions(user) && <th style={{ minWidth: "13rem" }}>Admin fix</th>}
            </tr>
          </thead>
          <tbody>
            {rowModels.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    (canMarkCommissionPaid(user) ? 1 : 0) +
                    (canEditCommissions(user) ? 1 : 0) +
                    6 +
                    (showCalcTrace ? 1 : 0)
                  }
                  style={{ color: "var(--muted)" }}
                >
                  No commission lines with a balance still owed (after ledger + posted checks).
                </td>
              </tr>
            ) : (
              rowModels.map((m) => {
                const { c, lines, linesAllLen, displayPaid, displayOwed, payoutSum, sub, rowHl } = m;
                const more = linesAllLen > 15 ? (
                  <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                    Showing 15 most recent — open <Link href="/dashboard/commissions/payout-summary">Payout rollups</Link>{" "}
                    for full history and totals.
                  </p>
                ) : null;

                return (
                  <tr key={c.id} className={rowHl}>
                    <td style={{ minWidth: "9.5rem" }}>
                      <Link
                        href={jobsDrilldownUrl({
                          year: c.job.year,
                          q: c.job.jobNumber,
                        })}
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        <div className="job-cell-num">{c.job.jobNumber}</div>
                      </Link>
                      {sub && <div className="cell-sub">{sub}</div>}
                    </td>
                    <td className="cell-nowrap">
                      {displaySalespersonName(c.salesperson.name)}
                      {!c.salesperson.active ? (
                        <span className="cell-muted" style={{ fontSize: "0.75rem", display: "block" }}>
                          Inactive · $0 owed
                        </span>
                      ) : null}
                    </td>
                    <td className="cell-num">
                      {money2(displayPaid)}
                      {payoutSum > 0.005 && c.paidAmount.toNumber() + 0.005 < payoutSum ? (
                        <div className="cell-muted" style={{ fontSize: "0.72rem", marginTop: "0.2rem" }}>
                          Ledger {money2(c.paidAmount.toNumber())} · checks {money2(payoutSum)}
                        </div>
                      ) : null}
                    </td>
                    <td className="cell-num">{money2(displayOwed)}</td>
                    <td style={{ maxWidth: 420, fontSize: "0.82rem", lineHeight: 1.45, verticalAlign: "top" }}>
                      {lines.length === 0 ? (
                        <span className="cell-muted">—</span>
                      ) : (
                        <>
                          <ul className="payout-history">
                            {lines.map((p) => (
                              <li key={p.id}>
                                <strong>{money2(p.amount.toNumber())}</strong>
                                <div style={{ marginTop: "0.15rem" }}>
                                  <span className="cell-muted">Pay period:</span> {p.payPeriodLabel}
                                </div>
                                <div className="cell-muted" style={{ fontSize: "0.78rem" }}>
                                  Posted {formatDateInEastern(p.createdAt)}
                                </div>
                              </li>
                            ))}
                          </ul>
                          {more}
                        </>
                      )}
                    </td>
                    {showCalcTrace && (
                      <td style={{ verticalAlign: "top" }}>
                        <CommissionExplainButton commissionId={c.id} />
                      </td>
                    )}
                    <td>{c.override ? <span className="status-pill status-pill--warn">Override</span> : ""}</td>
                    {canMarkCommissionPaid(user) && (
                      <td style={{ verticalAlign: "top" }}>
                        {!c.override && c.salesperson.active && displayOwed > 0 ? (
                          <PayCommissionForm
                            commissionId={c.id}
                            defaultOwed={displayOwed}
                            suggestedPaydayIso={selectedPaydayIso}
                          />
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                    )}
                    {canEditCommissions(user) && (
                      <td style={{ verticalAlign: "top" }}>
                        <CommissionLineAdminForm
                          commissionId={c.id}
                          ledgerPaid={c.paidAmount.toNumber()}
                          displayOwed={displayOwed}
                          override={c.override}
                          salespersonName={displaySalespersonName(c.salesperson.name)}
                        />
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
