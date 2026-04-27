"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";

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
  key: string;
  payPeriodLabel: string;
  count: number;
  total: number;
  periodSortAt: string;
  lastPostedLabel: string;
  lastPostedAt: string;
  lines: PayPeriodAllRepsLine[];
};

type SalespersonRollup = {
  salespersonName: string;
  total: number;
  lineCount: number;
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

type PayoutLineEditForm = {
  amount: string;
  notes: string;
};

export function PayPeriodAllRepsTable({
  rows,
  canManagePayoutLines = false,
}: {
  rows: PayPeriodAllRepsRow[];
  canManagePayoutLines?: boolean;
}) {
  const router = useRouter();
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const [localRows, setLocalRows] = useState<PayPeriodAllRepsRow[]>(rows);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PayoutLineEditForm | null>(null);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setLocalRows(
      [...rows].sort(
        (a, b) =>
          new Date(b.periodSortAt).getTime() - new Date(a.periodSortAt).getTime() ||
          new Date(b.lastPostedAt).getTime() - new Date(a.lastPostedAt).getTime()
      )
    );
  }, [rows]);

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
          lines: [],
        };
      salesperson.total += line.amount;
      salesperson.lineCount += 1;
      salesperson.lines.push(line);
      bySalesperson.set(salespersonName, salesperson);
    }
    return [...bySalesperson.values()]
      .map((sp) => {
        sp.lines.sort(
          (a, b) =>
            b.amount - a.amount ||
            (a.jobNumber ?? "").localeCompare(b.jobNumber ?? "", undefined, { numeric: true }) ||
            a.id.localeCompare(b.id)
        );
        return sp;
      })
      .sort(
        (a, b) =>
          b.total - a.total ||
          a.salespersonName.localeCompare(b.salespersonName, undefined, { sensitivity: "base" })
      );
  };

  const beginEditLine = useCallback((line: PayPeriodAllRepsLine) => {
    setEditingLineId(line.id);
    setEditForm({
      amount: line.amount.toFixed(2),
      notes: line.notes ?? "",
    });
    setMsg(null);
  }, []);

  const cancelEditLine = useCallback(() => {
    if (busyLineId) return;
    setEditingLineId(null);
    setEditForm(null);
  }, [busyLineId]);

  const saveLine = useCallback(
    async (line: PayPeriodAllRepsLine) => {
      if (!editForm || !canManagePayoutLines || busyLineId) return;
      const amount = Number(editForm.amount.trim());
      if (!Number.isFinite(amount) || amount <= 0) {
        setMsg("Amount must be a positive number.");
        return;
      }

      setBusyLineId(line.id);
      setMsg(null);
      try {
        const res = await fetch(`/api/commissions/payouts/${line.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            notes: editForm.notes.trim() ? editForm.notes.trim() : null,
          }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMsg(typeof j.error === "string" ? j.error : "Failed to update payout line.");
          return;
        }

        const updatedAmount = typeof j?.payout?.amount === "number" ? j.payout.amount : amount;
        const updatedNotes =
          typeof j?.payout?.notes === "string" || j?.payout?.notes === null
            ? j.payout.notes
            : editForm.notes.trim() || null;

        setLocalRows((prev) =>
          prev.map((row) => {
            const existing = row.lines.find((l) => l.id === line.id);
            if (!existing) return row;
            const delta = updatedAmount - existing.amount;
            return {
              ...row,
              total: row.total + delta,
              lines: row.lines.map((l) =>
                l.id === line.id
                  ? {
                      ...l,
                      amount: updatedAmount,
                      notes: updatedNotes,
                    }
                  : l
              ),
            };
          })
        );

        setEditingLineId(null);
        setEditForm(null);
        setMsg("Payout line updated.");
        router.refresh();
      } catch {
        setMsg("Network error updating payout line.");
      } finally {
        setBusyLineId(null);
      }
    },
    [busyLineId, canManagePayoutLines, editForm, router]
  );

  const deleteLine = useCallback(
    async (line: PayPeriodAllRepsLine) => {
      if (!canManagePayoutLines || busyLineId) return;
      const ok = window.confirm("Remove this payout line? This will reverse that payout from commission totals.");
      if (!ok) return;

      setBusyLineId(line.id);
      setMsg(null);
      try {
        const res = await fetch(`/api/commissions/payouts/${line.id}`, { method: "DELETE" });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMsg(typeof j.error === "string" ? j.error : "Failed to remove payout line.");
          return;
        }

        setLocalRows((prev) =>
          prev
            .map((row) => {
              const existing = row.lines.find((l) => l.id === line.id);
              if (!existing) return row;
              return {
                ...row,
                count: Math.max(0, row.count - 1),
                total: row.total - existing.amount,
                lines: row.lines.filter((l) => l.id !== line.id),
              };
            })
            .filter((row) => row.count > 0)
        );
        if (editingLineId === line.id) {
          setEditingLineId(null);
          setEditForm(null);
        }
        setMsg("Payout line removed.");
        router.refresh();
      } catch {
        setMsg("Network error removing payout line.");
      } finally {
        setBusyLineId(null);
      }
    },
    [busyLineId, canManagePayoutLines, editingLineId, router]
  );

  function payPeriodWithYear(row: PayPeriodAllRepsRow): string {
    const dt = new Date(row.periodSortAt);
    if (Number.isNaN(dt.getTime())) return row.payPeriodLabel;
    return `${row.payPeriodLabel}, ${dt.getUTCFullYear()}`;
  }

  return (
    <div>
      {msg ? (
        <p style={{ margin: "0 0 0.65rem", fontSize: "0.84rem", color: "var(--muted)" }}>{msg}</p>
      ) : null}
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
          {localRows.map((s) => {
            const open = openLabel === s.key;
            return (
              <Fragment key={s.key}>
                <tr
                  className="payout-expand-row"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => toggle(s.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(s.key);
                    }
                  }}
                >
                  <td className="cell-muted" style={{ fontSize: "0.75rem", userSelect: "none" }}>
                    {open ? "▼" : "▶"}
                  </td>
                  <td style={{ fontWeight: 600 }}>{payPeriodWithYear(s)}</td>
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
                                {canManagePayoutLines ? <th>Actions</th> : null}
                              </tr>
                            </thead>
                            <tbody>
                              {groupedBySalesperson(s.lines).map((sp) => (
                                <Fragment key={`${s.key}-${sp.salespersonName}`}>
                                  <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                                    <td className="cell-nowrap cell-strong">{sp.salespersonName}</td>
                                    <td className="cell-muted" style={{ fontSize: "0.8rem" }}>
                                      {sp.lineCount} payout
                                      line{sp.lineCount === 1 ? "" : "s"}
                                    </td>
                                    <td className="cell-num cell-strong">{money2(sp.total)}</td>
                                    <td className="cell-num">—</td>
                                    <td className="cell-muted">—</td>
                                    <td className="cell-muted">—</td>
                                    {canManagePayoutLines ? <td className="cell-muted">—</td> : null}
                                  </tr>
                                  {sp.lines.map((line) => {
                                    const isEditing = editingLineId === line.id && editForm !== null;
                                    return (
                                    <tr key={line.id}>
                                      <td className="cell-muted" style={{ fontSize: "0.78rem" }}>
                                        ↳
                                      </td>
                                      <td style={{ maxWidth: 260 }}>
                                        {line.jobNumber ? (
                                          <span className="cell-strong">{line.jobNumber}</span>
                                        ) : (
                                          <span className="cell-muted">No linked job</span>
                                        )}
                                        {line.jobName ? (
                                          <div className="cell-sub cell-muted" style={{ marginTop: 2 }}>
                                            {line.jobName}
                                          </div>
                                        ) : null}
                                      </td>
                                      <td className="cell-num">
                                        {isEditing ? (
                                          <input
                                            className="input"
                                            inputMode="decimal"
                                            value={editForm.amount}
                                            onChange={(e) =>
                                              setEditForm((prev) => (prev ? { ...prev, amount: e.target.value } : prev))
                                            }
                                            style={{ minWidth: "8rem" }}
                                          />
                                        ) : (
                                          money2(line.amount)
                                        )}
                                      </td>
                                      <td className="cell-num">{line.jobYear ?? "—"}</td>
                                      <td style={{ maxWidth: 260, fontSize: "0.82rem" }}>
                                        {isEditing ? (
                                          <input
                                            className="input"
                                            value={editForm.notes}
                                            onChange={(e) =>
                                              setEditForm((prev) => (prev ? { ...prev, notes: e.target.value } : prev))
                                            }
                                            placeholder="Optional notes"
                                          />
                                        ) : line.notes?.trim() ? (
                                          line.notes
                                        ) : (
                                          <span className="cell-muted">—</span>
                                        )}
                                      </td>
                                      <td className="cell-muted cell-nowrap" style={{ fontSize: "0.8rem" }}>
                                        {line.postedLabel}
                                      </td>
                                      {canManagePayoutLines ? (
                                        <td style={{ whiteSpace: "normal" }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                                            {isEditing ? (
                                              <>
                                                <button
                                                  type="button"
                                                  className="btn"
                                                  onClick={() => void saveLine(line)}
                                                  disabled={busyLineId === line.id}
                                                >
                                                  {busyLineId === line.id ? "Saving..." : "Save"}
                                                </button>
                                                <button
                                                  type="button"
                                                  className="btn secondary"
                                                  onClick={cancelEditLine}
                                                  disabled={busyLineId === line.id}
                                                >
                                                  Cancel
                                                </button>
                                              </>
                                            ) : (
                                              <>
                                                <button
                                                  type="button"
                                                  className="btn secondary"
                                                  onClick={() => beginEditLine(line)}
                                                  disabled={busyLineId != null}
                                                  style={{ padding: "0.35rem 0.7rem" }}
                                                >
                                                  Edit
                                                </button>
                                                <button
                                                  type="button"
                                                  className="btn secondary"
                                                  onClick={() => void deleteLine(line)}
                                                  disabled={busyLineId != null}
                                                  style={{
                                                    borderColor: "rgba(239, 68, 68, 0.6)",
                                                    color: "#fecaca",
                                                    padding: "0.35rem 0.7rem",
                                                  }}
                                                >
                                                  {busyLineId === line.id ? "Removing..." : "Remove"}
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      ) : null}
                                    </tr>
                                  )})}
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
