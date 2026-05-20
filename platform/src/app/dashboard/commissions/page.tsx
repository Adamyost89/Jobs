import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  canViewAllJobs,
  canMarkCommissionPaid,
  canEditCommissions,
  canViewJobContractAndPaidForCommissions,
  canViewHrPayroll,
} from "@/lib/rbac";
import { PayCommissionForm } from "@/components/PayCommissionForm";
import { CommissionLineAdminForm } from "@/components/CommissionLineAdminForm";
import { getPayPeriodForPayday, getUpcomingFridayIsoForPayrollTz, parseIsoDateAtNoonUtc } from "@/lib/pay-period";
import { formatDateInEastern } from "@/lib/payout-display";
import Link from "next/link";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";
import type { Prisma } from "@prisma/client";
import { commissionDisplayAmounts, roundMoney } from "@/lib/commission-display";
import { jobNumberSortKey } from "@/lib/job-sort";
import {
  displaySalespersonName,
  salespersonCommissionFilterByDisplayToken,
} from "@/lib/salesperson-name";
import { CommissionExplainButton } from "@/components/CommissionExplainButton";
import { commissionJobAllowedForPayoutSheetWhere } from "@/lib/end-of-job-form";
import { quoteLinksByJobIds } from "@/lib/job-quote-links";
import { JobQuotePickerLink } from "@/components/JobQuotePickerLink";
import { JobContractPaidHints } from "@/components/JobContractPaidHints";

function parsePaydayParam(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const t = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function commissionsListUrl(params: { payday?: string; spn?: string }): string {
  const q = new URLSearchParams();
  if (params.payday?.trim()) q.set("payday", params.payday.trim());
  if (params.spn?.trim()) q.set("spn", params.spn.trim());
  const s = q.toString();
  return s ? `/dashboard/commissions?${s}` : "/dashboard/commissions";
}

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const user = await getSession();
  if (!user) return null;
  const showCalcTrace = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const canFilterBySalesperson = canViewHrPayroll(user);
  const salespersonDisplayToken = canFilterBySalesperson ? pickString(sp.spn)?.trim() : undefined;

  const defaultPaydayIso = getUpcomingFridayIsoForPayrollTz(new Date());
  const selectedPaydayIso = parsePaydayParam(sp.payday) ?? defaultPaydayIso;
  const selectedPaydayDate = parseIsoDateAtNoonUtc(selectedPaydayIso) ?? new Date();
  const suggestedPayPeriod = getPayPeriodForPayday(selectedPaydayDate).label;

  const parts: Prisma.CommissionWhereInput[] = [];
  parts.push({ owedAmount: { gt: 0 } });
  parts.push(commissionJobAllowedForPayoutSheetWhere);
  if (!canViewAllJobs(user)) {
    parts.push(
      user.salespersonIds.length > 0
        ? { salespersonId: { in: user.salespersonIds } }
        : { id: "__none__" }
    );
  }
  const baseWhere: Prisma.CommissionWhereInput =
    parts.length === 0 ? {} : parts.length === 1 ? parts[0]! : { AND: parts };

  const salespersonOptionRows = canFilterBySalesperson
    ? await prisma.commission.findMany({
        where: baseWhere,
        select: { salesperson: { select: { name: true } } },
        take: 5000,
      })
    : [];
  const salespersonOptions = (() => {
    const names = new Set<string>();
    for (const row of salespersonOptionRows) {
      const display = displaySalespersonName(row.salesperson.name);
      if (display) names.add(display);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  })();

  if (salespersonDisplayToken) {
    parts.push(salespersonCommissionFilterByDisplayToken(salespersonDisplayToken));
  }
  const where: Prisma.CommissionWhereInput =
    parts.length === 0 ? {} : parts.length === 1 ? parts[0]! : { AND: parts };

  const rows = await prisma.commission.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      job: {
        select: {
          jobNumber: true,
          name: true,
          year: true,
          leadNumber: true,
          contractAmount: true,
          amountPaid: true,
        },
      },
      salesperson: { select: { name: true, active: true } },
    },
  });
  const quoteLinksByJob = await quoteLinksByJobIds([...new Set(rows.map((c) => c.jobId))]);

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
      <div className="page-title-row">
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
      {canFilterBySalesperson ? (
        <form method="get" className="card" style={{ padding: "0.85rem 1.15rem" }}>
          <div className="filter-bar">
            {canMarkCommissionPaid(user) ? (
              <input type="hidden" name="payday" value={selectedPaydayIso} />
            ) : null}
            <label>
              Salesperson
              <select name="spn" defaultValue={salespersonDisplayToken || ""}>
                <option value="">All reps</option>
                {salespersonOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div className="filter-bar__actions">
              <button className="btn" type="submit">
                Apply
              </button>
              <Link
                href={commissionsListUrl({
                  payday: canMarkCommissionPaid(user) ? selectedPaydayIso : undefined,
                })}
                className="btn secondary"
                style={{ textDecoration: "none" }}
              >
                All reps
              </Link>
            </div>
          </div>
        </form>
      ) : null}
      {canMarkCommissionPaid(user) ? (
        <form method="GET" className="page-actions-inline">
          {salespersonDisplayToken ? (
            <input type="hidden" name="spn" value={salespersonDisplayToken} />
          ) : null}
          <label htmlFor="payday" style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
            Payday for all lines:
          </label>
          <input
            id="payday"
            name="payday"
            type="date"
            defaultValue={selectedPaydayIso}
            className="compact-field"
          />
          <button className="btn" type="submit" style={{ fontSize: "0.82rem" }}>
            Set payday
          </button>
          <Link
            className="btn btn-ghost"
            href={commissionsListUrl({ spn: salespersonDisplayToken })}
            style={{ fontSize: "0.82rem" }}
          >
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

      {canFilterBySalesperson && salespersonDisplayToken ? (
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
          Showing <strong style={{ color: "var(--text)" }}>{rowModels.length}</strong> line
          {rowModels.length === 1 ? "" : "s"} for <strong style={{ color: "var(--text)" }}>{salespersonDisplayToken}</strong>
        </p>
      ) : null}

      <div className="card" style={{ padding: "0.35rem 0 0.85rem" }}>
        <div className="table-responsive">
          <table className="table table-data table-data--commissions">
          <thead>
            <tr>
              <th>Job</th>
              <th style={{ minWidth: "6.75rem" }}>Salesperson</th>
              <th className="cell-num" style={{ minWidth: "8.5rem" }}>Paid (ledger + checks)</th>
              <th className="cell-num" style={{ minWidth: "7.25rem" }}>Still owed</th>
              <th>Lock</th>
              {canMarkCommissionPaid(user) && <th style={{ minWidth: "10.25rem" }}>Post payment</th>}
              <th style={{ minWidth: "12rem" }}>Payment history</th>
              {showCalcTrace && <th style={{ minWidth: "8.25rem" }}>Calc trace</th>}
              {canEditCommissions(user) && <th style={{ minWidth: "10.5rem" }}>Admin fix</th>}
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
                    <td style={{ minWidth: "8.75rem" }}>
                      <div className="job-cell-num">
                        <JobQuotePickerLink
                          fallbackHref={jobsDrilldownUrl({
                            year: c.job.year,
                            q: c.job.jobNumber,
                          })}
                          fallbackLabel={c.job.jobNumber}
                          quoteLinks={quoteLinksByJob.get(c.jobId) ?? []}
                          style={{ color: "inherit", textDecoration: "none" }}
                        />
                      </div>
                      {sub && <div className="cell-sub">{sub}</div>}
                      {canViewJobContractAndPaidForCommissions(user) ? (
                        <JobContractPaidHints
                          contractAmount={c.job.contractAmount.toNumber()}
                          amountPaid={c.job.amountPaid?.toNumber() ?? null}
                        />
                      ) : null}
                    </td>
                    <td className="cell-nowrap" style={{ minWidth: "6.75rem" }}>
                      {displaySalespersonName(c.salesperson.name)}
                      {!c.salesperson.active ? (
                        <span className="cell-muted" style={{ fontSize: "0.75rem", display: "block" }}>
                          Inactive · $0 owed
                        </span>
                      ) : null}
                    </td>
                    <td className="cell-num" style={{ minWidth: "8.5rem" }}>
                      {money2(displayPaid)}
                      {payoutSum > 0.005 && c.paidAmount.toNumber() + 0.005 < payoutSum ? (
                        <div className="cell-muted" style={{ fontSize: "0.72rem", marginTop: "0.2rem" }}>
                          Ledger {money2(c.paidAmount.toNumber())} · checks {money2(payoutSum)}
                        </div>
                      ) : null}
                    </td>
                    <td className="cell-num" style={{ minWidth: "7.25rem" }}>{money2(displayOwed)}</td>
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
                    <td style={{ maxWidth: 320, fontSize: "0.82rem", lineHeight: 1.45, verticalAlign: "top" }}>
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
    </div>
  );
}
