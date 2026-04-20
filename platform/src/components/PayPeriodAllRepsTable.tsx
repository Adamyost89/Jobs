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

  return (
    <div style={{ overflowX: "auto" }}>
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
                          Posted payouts in this period (click the row above to collapse).
                        </p>
                        <div style={{ overflowX: "auto" }}>
                          <table className="table table-data" style={{ margin: 0, fontSize: "0.84rem" }}>
                            <thead>
                              <tr>
                                <th>Salesperson</th>
                                <th className="cell-num">Amount</th>
                                <th>Job</th>
                                <th className="cell-num">Year</th>
                                <th>Notes</th>
                                <th>Posted</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.lines.map((l) => (
                                <tr key={l.id}>
                                  <td className="cell-nowrap">{l.salespersonName}</td>
                                  <td className="cell-num cell-strong">{money2(l.amount)}</td>
                                  <td style={{ maxWidth: 200 }}>
                                    {l.jobNumber ? (
                                      <span className="cell-strong">{l.jobNumber}</span>
                                    ) : (
                                      <span className="cell-muted">—</span>
                                    )}
                                    {l.jobName ? (
                                      <div className="cell-sub cell-muted" style={{ marginTop: 2 }}>
                                        {l.jobName}
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="cell-num">{l.jobYear ?? "—"}</td>
                                  <td style={{ maxWidth: 260, fontSize: "0.82rem" }}>
                                    {l.notes?.trim() ? l.notes : <span className="cell-muted">—</span>}
                                  </td>
                                  <td className="cell-muted cell-nowrap" style={{ fontSize: "0.8rem" }}>
                                    {l.postedLabel}
                                  </td>
                                </tr>
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
