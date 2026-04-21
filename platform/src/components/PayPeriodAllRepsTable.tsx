"use client";

import { Fragment, useCallback, useState } from "react";

export type PayPeriodAllRepsLine = {
  id: string;
  amount: number;
  salespersonName: string;
  jobNumber: string | null;
  jobName: string | null;
  jobYear: number | null;
  notes: string | null;
  postedLabel: string;
};

export type PayPeriodAllRepsRow = {
  payPeriodLabel: string;
  count: number;
  total: number;
  lastPostedLabel: string;
  lines: PayPeriodAllRepsLine[];
};

type JobRollup = {
  jobNumber: string | null;
  jobName: string | null;
  jobYear: number | null;
  notes: string | null;
  postedLabel: string;
  total: number;
  lineCount: number;
};

type SalespersonRollup = {
  salespersonName: string;
  total: number;
  lineCount: number;
  jobs: JobRollup[];
};

function money2(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PayPeriodAllRepsTable({ rows }: { rows: PayPeriodAllRepsRow[] }) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);

  const toggle = useCallback((label: string) => {
    setOpenLabel((cur) => (cur === label ? null : label));
  }, []);

  const groupedBySalesperson = (lines: PayPeriodAllRepsLine[]): SalespersonRollup[] => {
    const bySalesperson = new Map<string, SalespersonRollup>();
    for (const line of lines) {
      const salespersonName = line.salespersonName?.trim() || "Unassigned";
      const salesperson =
        bySalesperson.get(salespersonName) ??
        {
          salespersonName,
          total: 0,
          lineCount: 0,
          jobs: [],
        };
      salesperson.total += line.amount;
      salesperson.lineCount += 1;

      const jobKey = `${line.jobNumber ?? "__none__"}|${line.jobYear ?? "__none__"}|${line.jobName ?? "__none__"}`;
      const jobIdx = salesperson.jobs.findIndex(
        (j) => `${j.jobNumber ?? "__none__"}|${j.jobYear ?? "__none__"}|${j.jobName ?? "__none__"}` === jobKey
      );
      if (jobIdx === -1) {
        salesperson.jobs.push({
          jobNumber: line.jobNumber,
          jobName: line.jobName,
          jobYear: line.jobYear,
          notes: line.notes,
          postedLabel: line.postedLabel,
          total: line.amount,
          lineCount: 1,
        });
      } else {
        const cur = salesperson.jobs[jobIdx]!;
        cur.total += line.amount;
        cur.lineCount += 1;
        if (!cur.notes?.trim() && line.notes?.trim()) {
          cur.notes = line.notes;
        }
      }
      bySalesperson.set(salespersonName, salesperson);
    }
    return [...bySalesperson.values()]
      .map((sp) => {
        sp.jobs.sort((a, b) => (b.total - a.total) || (a.jobNumber ?? "").localeCompare(b.jobNumber ?? "", undefined, { numeric: true }));
        return sp;
      })
      .sort(
        (a, b) =>
          b.total - a.total ||
          a.salespersonName.localeCompare(b.salespersonName, undefined, { sensitivity: "base" })
      );
  };

  return (
    <div>
      <table className="table table-data">
        <thead>
          <tr>
            <th style={{ width: "2rem" }} aria-hidden />
            <th>Pay period (check bucket)</th>
            <th className="cell-num"># line items</th>
            <th className="cell-num">Total paid</th>
            <th>Last activity (posted)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const open = openLabel === s.payPeriodLabel;
            return (
              <Fragment key={s.payPeriodLabel}>
                <tr
                  className="payout-expand-row"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => toggle(s.payPeriodLabel)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(s.payPeriodLabel);
                    }
                  }}
                >
                  <td className="cell-muted" style={{ fontSize: "0.75rem", userSelect: "none" }}>
                    {open ? "▼" : "▶"}
                  </td>
                  <td style={{ fontWeight: 600 }}>{s.payPeriodLabel}</td>
                  <td className="cell-num">{s.count}</td>
                  <td className="cell-num cell-strong">{money2(s.total)}</td>
                  <td className="cell-muted" style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>
                    {s.lastPostedLabel}
                  </td>
                </tr>
                {open && (
                  <tr className="payout-expand-detail">
                    <td colSpan={5} style={{ padding: 0, background: "rgba(0,0,0,0.2)", borderBottom: "1px solid #2a3545" }}>
                      <div style={{ padding: "0.65rem 0.75rem 0.85rem" }}>
                        <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                          Posted payouts in this period grouped by salesperson (click the row above to collapse).
                        </p>
                        <div>
                          <table className="table table-data" style={{ margin: 0, fontSize: "0.84rem" }}>
                            <thead>
                              <tr>
                                <th>Salesperson</th>
                                <th>Job</th>
                                <th className="cell-num">Amount</th>
                                <th className="cell-num">Year</th>
                                <th>Notes</th>
                                <th>Posted</th>
                              </tr>
                            </thead>
                            <tbody>
                              {groupedBySalesperson(s.lines).map((sp) => (
                                <Fragment key={`${s.payPeriodLabel}-${sp.salespersonName}`}>
                                  <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                                    <td className="cell-nowrap cell-strong">{sp.salespersonName}</td>
                                    <td className="cell-muted" style={{ fontSize: "0.8rem" }}>
                                      {sp.jobs.length} job{sp.jobs.length === 1 ? "" : "s"} · {sp.lineCount} payout
                                      line{sp.lineCount === 1 ? "" : "s"}
                                    </td>
                                    <td className="cell-num cell-strong">{money2(sp.total)}</td>
                                    <td className="cell-num">—</td>
                                    <td className="cell-muted">—</td>
                                    <td className="cell-muted">—</td>
                                  </tr>
                                  {sp.jobs.map((j) => (
                                    <tr key={`${s.payPeriodLabel}-${sp.salespersonName}-${j.jobNumber}-${j.jobYear}-${j.jobName}`}>
                                      <td className="cell-muted" style={{ fontSize: "0.78rem" }}>
                                        ↳
                                      </td>
                                      <td style={{ maxWidth: 260 }}>
                                        {j.jobNumber ? (
                                          <span className="cell-strong">{j.jobNumber}</span>
                                        ) : (
                                          <span className="cell-muted">No linked job</span>
                                        )}
                                        {j.jobName ? (
                                          <div className="cell-sub cell-muted" style={{ marginTop: 2 }}>
                                            {j.jobName}
                                          </div>
                                        ) : null}
                                      </td>
                                      <td className="cell-num">{money2(j.total)}</td>
                                      <td className="cell-num">{j.jobYear ?? "—"}</td>
                                      <td style={{ maxWidth: 260, fontSize: "0.82rem" }}>
                                        {j.notes?.trim() ? j.notes : <span className="cell-muted">—</span>}
                                      </td>
                                      <td className="cell-muted cell-nowrap" style={{ fontSize: "0.8rem" }}>
                                        {j.postedLabel}
                                      </td>
                                    </tr>
                                  ))}
                                </Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
