"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";
import { JobCostEditor } from "@/components/JobCostEditor";
import { JobsDashboardPrefsForm } from "@/components/JobsDashboardPrefsForm";
import { JobPaidInFullToggle } from "@/components/JobPaidInFullToggle";
import { formatGpPercent, formatJobGpDisplay } from "@/lib/job-row-highlight";
import type { JobLike } from "@/lib/job-row-highlight";
import { hasDisplayableGp } from "@/lib/job-workflow";
import {
  resolveStatusBadgeColors,
  statusColumnLabel,
  type StatusBadgeColorMap,
} from "@/lib/status-badge-colors";
import {
  DEFAULT_JOBS_TABLE_PREFS,
  type HlColors,
  JOB_TABLE_COLUMN_LABELS,
  type JobTableColumnId,
  type JobsTablePrefsV1,
  loadJobsTablePrefsFromStorage,
  saveJobsTablePrefsToStorage,
  visibleColumnOrder,
} from "@/lib/jobs-table-preferences";
import { canEditJobs, canViewAllJobs, type SessionUser } from "@/lib/rbac";
import { formatUsd } from "@/lib/currency";

export type JobsTableRowDTO = {
  id: string;
  jobNumber: string;
  year: number;
  contractSignedAt: string | null;
  leadNumber: string | null;
  name: string | null;
  salespersonName: string | null;
  status: string;
  /** ProLine pipeline stage; when set, shown in the Status column instead of `status`. */
  prolineStage?: string | null;
  contractAmount: number;
  changeOrders: number;
  invoicedTotal: number;
  amountPaid: number | null;
  paidDate: string | null;
  retailPercent: number | null;
  insurancePercent: number | null;
  cost: number;
  paidInFull: boolean;
  gp: number;
  gpPercent: number;
  projectRevenue: number;
  /** When null, no commission rows exist for this job. */
  commPaid: number | null;
  commOwed: number | null;
};

function toJobLike(row: JobsTableRowDTO): JobLike {
  return {
    status: row.status,
    gp: row.gp,
    gpPercent: row.gpPercent,
    projectRevenue: row.projectRevenue,
    invoicedTotal: row.invoicedTotal,
    contractAmount: row.contractAmount,
    changeOrders: row.changeOrders,
    cost: row.cost,
    paidInFull: row.paidInFull,
  };
}

function rowHighlightStyle(c: HlColors): CSSProperties {
  return {
    boxShadow: `inset 3px 0 0 0 ${c.border}`,
    background: c.rowBg,
  };
}

function toPercentNumber(v: number): number {
  if (!Number.isFinite(v)) return NaN;
  // Match Apps Script `asPercentNumber`: treat decimal fractions as percentages.
  return Math.abs(v) <= 1 ? v * 100 : v;
}

export function JobsTableSection({
  rows,
  user,
  statusBadgeColors,
}: {
  rows: JobsTableRowDTO[];
  user: SessionUser;
  statusBadgeColors: StatusBadgeColorMap;
}) {
  const router = useRouter();
  const canEdit = canEditJobs(user);
  const canEditPayments = user.role === "SUPER_ADMIN";
  const canSeeGp = canViewAllJobs(user);
  const canEditTablePrefs = user.role === "SUPER_ADMIN";
  const [prefs, setPrefs] = useState<JobsTablePrefsV1>(DEFAULT_JOBS_TABLE_PREFS);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null);
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    leadNumber: string;
    status: string;
    contractAmount: string;
    changeOrders: string;
    invoicedTotal: string;
    amountPaid: string;
    projectRevenue: string;
    paidDate: string;
    paidInFull: boolean;
    contractSignedAt: string;
  } | null>(null);
  const [editMsg, setEditMsg] = useState<string | null>(null);

  useEffect(() => {
    setPrefs(loadJobsTablePrefsFromStorage());
  }, []);

  const persist = useCallback((next: JobsTablePrefsV1) => {
    setPrefs(next);
    saveJobsTablePrefsToStorage(next);
  }, []);

  const cols = useMemo(
    () =>
      visibleColumnOrder(prefs).filter(
        (id) => canSeeGp || (id !== "gp" && id !== "gpPct" && id !== "retail" && id !== "insurance")
      ),
    [prefs, canSeeGp]
  );
  const visibleRows = useMemo(
    () => rows.filter((row) => !deletedIds.has(row.id)),
    [rows, deletedIds]
  );

  const money = (n: number) => formatUsd(n);

  const h = prefs.highlights;
  const deleteJob = useCallback(
    async (row: JobsTableRowDTO) => {
      if (!canEdit || deletingId) return;
      const ok = window.confirm(
        `Delete job ${row.jobNumber}? This permanently removes the project record and frees this job number for reuse.`
      );
      if (!ok) return;
      setDeletingId(row.id);
      setDeleteMsg(null);
      try {
        const res = await fetch(`/api/jobs/${row.id}`, { method: "DELETE" });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setDeleteMsg(typeof j.error === "string" ? j.error : "Failed to delete job.");
          return;
        }
        setDeletedIds((prev) => new Set(prev).add(row.id));
        setDeleteMsg(`Deleted job ${row.jobNumber}. This number is now available again.`);
        router.refresh();
      } catch {
        setDeleteMsg("Network error deleting job.");
      } finally {
        setDeletingId(null);
      }
    },
    [canEdit, deletingId, router]
  );

  const recheckCommission = useCallback(
    async (row: JobsTableRowDTO) => {
      if (!canEditPayments || recheckingId || deletingId || savingEditId) return;
      setRecheckingId(row.id);
      setRecheckMsg(null);
      setDeleteMsg(null);
      setEditMsg(null);
      try {
        const res = await fetch(`/api/admin/jobs/${row.id}/recheck-commission`, { method: "POST" });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setRecheckMsg(typeof j.error === "string" ? j.error : "Failed to recheck commission.");
          return;
        }
        const before = typeof j.commissionCountBefore === "number" ? j.commissionCountBefore : null;
        const after = typeof j.commissionCountAfter === "number" ? j.commissionCountAfter : null;
        const payoutCount = typeof j.payoutCount === "number" ? j.payoutCount : 0;
        const payoutSum = typeof j.payoutSum === "number" ? j.payoutSum : 0;
        setRecheckMsg(
          `Rechecked ${row.jobNumber}: commission lines ${before ?? "?"} → ${after ?? "?"}; payouts ${payoutCount} line${payoutCount === 1 ? "" : "s"} (${formatUsd(payoutSum)}).`
        );
        router.refresh();
      } catch {
        setRecheckMsg("Network error rechecking commission.");
      } finally {
        setRecheckingId(null);
      }
    },
    [canEditPayments, recheckingId, deletingId, savingEditId, router]
  );

  function toDateInputValue(iso: string | null): string {
    if (!iso) return "";
    return iso.slice(0, 10);
  }

  function toEditForm(row: JobsTableRowDTO) {
    return {
      name: row.name ?? "",
      leadNumber: row.leadNumber ?? "",
      status: row.status ?? "",
      contractAmount: String(row.contractAmount),
      changeOrders: String(row.changeOrders),
      invoicedTotal: String(row.invoicedTotal),
      amountPaid: row.amountPaid == null ? "" : String(row.amountPaid),
      projectRevenue: String(row.projectRevenue),
      paidDate: toDateInputValue(row.paidDate),
      paidInFull: row.paidInFull,
      contractSignedAt: toDateInputValue(row.contractSignedAt),
    };
  }

  function beginEdit(row: JobsTableRowDTO) {
    if (!canEdit || deletingId || savingEditId) return;
    setDeleteMsg(null);
    setEditMsg(null);
    setEditingId(row.id);
    setEditForm(toEditForm(row));
  }

  function cancelEdit() {
    if (savingEditId) return;
    setEditingId(null);
    setEditForm(null);
  }

  function parseMoneyInput(label: string, raw: string): { ok: true; value: number } | { ok: false; error: string } {
    const value = Number(raw.trim());
    if (!Number.isFinite(value)) return { ok: false, error: `${label} must be a valid number.` };
    return { ok: true, value };
  }

  const saveEdit = useCallback(
    async (row: JobsTableRowDTO) => {
      if (!canEdit || !editForm || editingId !== row.id || savingEditId) return;
      const status = editForm.status.trim();
      if (!status) {
        setEditMsg("Status is required.");
        return;
      }
      const contract = parseMoneyInput("Contract amount", editForm.contractAmount);
      if (!contract.ok) {
        setEditMsg(contract.error);
        return;
      }
      const changeOrders = parseMoneyInput("Change orders", editForm.changeOrders);
      if (!changeOrders.ok) {
        setEditMsg(changeOrders.error);
        return;
      }
      const invoicedTotal = parseMoneyInput("Invoiced total", editForm.invoicedTotal);
      if (!invoicedTotal.ok) {
        setEditMsg(invoicedTotal.error);
        return;
      }
      const projectRevenue = parseMoneyInput("Project revenue", editForm.projectRevenue);
      if (!projectRevenue.ok) {
        setEditMsg(projectRevenue.error);
        return;
      }
      const amountPaid = parseMoneyInput("Amount paid", editForm.amountPaid === "" ? "0" : editForm.amountPaid);
      if (!amountPaid.ok) {
        setEditMsg(amountPaid.error);
        return;
      }

      const payload = {
        name: editForm.name.trim() ? editForm.name.trim() : null,
        leadNumber: editForm.leadNumber.trim() ? editForm.leadNumber.trim() : null,
        status,
        contractAmount: contract.value,
        changeOrders: changeOrders.value,
        invoicedTotal: invoicedTotal.value,
        projectRevenue: projectRevenue.value,
        contractSignedAt: editForm.contractSignedAt.trim() ? editForm.contractSignedAt.trim() : null,
        ...(canEditPayments
          ? {
              amountPaid: editForm.amountPaid.trim() ? amountPaid.value : null,
              paidDate: editForm.paidDate.trim() ? editForm.paidDate.trim() : null,
              paidInFull: editForm.paidInFull,
            }
          : null),
      };

      setSavingEditId(row.id);
      setEditMsg(null);
      setDeleteMsg(null);
      try {
        const res = await fetch(`/api/jobs/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setEditMsg(typeof j.error === "string" ? j.error : "Failed to save job changes.");
          return;
        }
        setEditMsg(`Saved changes for job ${row.jobNumber}.`);
        setEditingId(null);
        setEditForm(null);
        router.refresh();
      } catch {
        setEditMsg("Network error saving job changes.");
      } finally {
        setSavingEditId(null);
      }
    },
    [canEdit, canEditPayments, editForm, editingId, savingEditId, router]
  );

  const legendBad = {
    background: h.colors.bad.legendBg,
    color: h.colors.bad.legendText,
  };
  const legendWarn = {
    background: h.colors.warn.legendBg,
    color: h.colors.warn.legendText,
  };

  function rowStyleForHighlight(row: JobsTableRowDTO): CSSProperties | undefined {
    const jl = toJobLike(row);
    if (!hasDisplayableGp(jl)) return undefined;

    const statusRaw = String(row.status ?? "").trim().toLowerCase();
    const statusNorm = statusRaw.replace(/[^a-z0-9]+/g, " ").trim();
    const isInBilling = statusNorm === "in billing";
    const isPaidClosed = statusNorm === "paid closed";
    const active = row.paidInFull === true && (isInBilling || isPaidClosed);
    if (!active) return undefined;

    const gpPct = toPercentNumber(row.gpPercent);
    const contractAmount = Number.isFinite(row.contractAmount) ? row.contractAmount : 0;

    if (Number.isFinite(gpPct) && gpPct < 32) return rowHighlightStyle(h.colors.bad); // red
    if ((Number.isFinite(gpPct) && gpPct < 50) || contractAmount < 5000) {
      return rowHighlightStyle(h.colors.warn); // yellow
    }
    if (Number.isFinite(gpPct) && gpPct >= 50 && gpPct < 60 && contractAmount > 5000) {
      return rowHighlightStyle(h.colors.medium); // blue
    }
    if (Number.isFinite(gpPct) && gpPct >= 60 && contractAmount > 5000) {
      return rowHighlightStyle(h.colors.good); // green
    }
    return undefined;
  }

  function renderTh(id: JobTableColumnId) {
    const label = JOB_TABLE_COLUMN_LABELS[id];
    const num =
      id === "contract" ||
      id === "changeOrders" ||
      id === "invoiced" ||
      id === "amountPaid" ||
      id === "retail" ||
      id === "insurance" ||
      id === "cost" ||
      id === "gp" ||
      id === "gpPct" ||
      id === "commPaid" ||
      id === "commOwed";
    return (
      <th key={id} className={num ? "cell-num" : undefined}>
        {label}
      </th>
    );
  }

  function renderTd(row: JobsTableRowDTO, id: JobTableColumnId) {
    switch (id) {
      case "jobNumber":
        return (
          <td key={id} className="cell-strong cell-nowrap">
            <Link
              href={jobsDrilldownUrl({ year: row.year, q: row.jobNumber })}
              style={{ color: "inherit", textDecoration: "none" }}
            >
              {row.jobNumber}
            </Link>
          </td>
        );
      case "year":
        return (
          <td key={id} className="cell-nowrap">
            {row.year}
          </td>
        );
      case "leadNumber":
        return (
          <td key={id} style={{ minWidth: "7rem" }}>
            {row.leadNumber ?? <span className="cell-muted">—</span>}
          </td>
        );
      case "name":
        return (
          <td key={id} style={{ maxWidth: "14rem" }}>
            {row.name?.trim() ? row.name : <span className="cell-muted">—</span>}
          </td>
        );
      case "sales":
        return (
          <td key={id} className="cell-nowrap">
            {row.salespersonName ?? <span className="cell-muted">—</span>}
          </td>
        );
      case "status":
        {
          const c = resolveStatusBadgeColors({
            status: row.status,
            prolineStage: row.prolineStage,
            customMap: statusBadgeColors,
          });
          return (
            <td key={id}>
              <span
                className="status-pill"
                style={{
                  background: c.background,
                  color: c.text,
                  border: `1px solid ${c.border}`,
                }}
              >
                {statusColumnLabel(row.status, row.prolineStage)}
              </span>
            </td>
          );
        }
      case "contract":
        return <td key={id} className="cell-num">{money(row.contractAmount)}</td>;
      case "changeOrders":
        return <td key={id} className="cell-num">{money(row.changeOrders)}</td>;
      case "invoiced":
        return <td key={id} className="cell-num">{money(row.invoicedTotal)}</td>;
      case "amountPaid":
        return (
          <td key={id} className="cell-num">
            {row.amountPaid != null ? money(row.amountPaid) : <span className="cell-muted">—</span>}
          </td>
        );
      case "retail":
        return (
          <td key={id} className="cell-num">
            {row.retailPercent != null ? `${row.retailPercent.toFixed(2)}%` : "—"}
          </td>
        );
      case "insurance":
        return (
          <td key={id} className="cell-num">
            {row.insurancePercent != null ? `${row.insurancePercent.toFixed(2)}%` : "—"}
          </td>
        );
      case "cost":
        return (
          <td key={id} className="cell-num">
            <JobCostEditor jobId={row.id} initialCost={row.cost} canEdit={canEdit} />
          </td>
        );
      case "paidInFull":
        return (
          <td key={id}>
            <JobPaidInFullToggle jobId={row.id} initial={row.paidInFull} canEdit={canEdit} />
          </td>
        );
      case "gp": {
        const jl = toJobLike(row);
        return (
          <td key={id} className="cell-num cell-strong">
            {formatJobGpDisplay(jl)}
          </td>
        );
      }
      case "gpPct": {
        const jl = toJobLike(row);
        return (
          <td key={id} className="cell-num cell-strong">
            {formatGpPercent(jl)}
          </td>
        );
      }
      case "commPaid":
        return (
          <td key={id} className="cell-num">
            {row.commPaid != null ? money(row.commPaid) : <span className="cell-muted">—</span>}
          </td>
        );
      case "commOwed":
        return (
          <td key={id} className="cell-num">
            {row.commOwed != null ? money(row.commOwed) : <span className="cell-muted">—</span>}
          </td>
        );
      default:
        return null;
    }
  }

  return (
    <div className="jobs-hl-vars">
      {canEditTablePrefs ? <JobsDashboardPrefsForm prefs={prefs} onChange={persist} variant="jobs" /> : null}

      {canSeeGp ? (
        <div className="card" style={{ fontSize: "0.82rem", color: "var(--muted)", lineHeight: 1.55 }}>
          <strong style={{ color: "var(--text)" }}>GP &amp; GP%</strong> come from the <strong style={{ color: "var(--text)" }}>sheet import</strong> when
          present. When <strong style={{ color: "var(--text)" }}>cost &gt; 0</strong> and the job is{" "}
          <strong style={{ color: "var(--text)" }}>paid in full</strong>, the app <strong style={{ color: "var(--text)" }}>recomputes</strong> GP from
          contract + change orders − cost.{" "}
          {canEdit ? (
            <>
              Use <strong style={{ color: "var(--text)" }}>Cost</strong> and the <strong style={{ color: "var(--text)" }}>Paid</strong> toggle when the
              invoice is settled to switch to realized GP.
            </>
          ) : null}
          <br />
          <strong style={{ color: "var(--text)" }}>Row colors</strong> (only when{" "}
          <strong style={{ color: "var(--text)" }}>Paid in full</strong> and{" "}
          <strong style={{ color: "var(--text)" }}>Status = In Billing or Paid &amp; Closed</strong>):{" "}
          <span className="row-legend" style={legendBad}>
            {h.labels.bad} (GP% &lt;32%)
          </span>{" "}
          ·{" "}
          <span className="row-legend" style={legendWarn}>
            {h.labels.warn} (GP% &lt;50% or Contract &lt;$5,000)
          </span>
          {" "}·{" "}
          <span className="row-legend" style={{ background: h.colors.medium.legendBg, color: h.colors.medium.legendText }}>
            {h.labels.medium} (GP% 50-59.99% and Contract &gt;$5,000)
          </span>{" "}
          ·{" "}
          <span className="row-legend" style={{ background: h.colors.good.legendBg, color: h.colors.good.legendText }}>
            {h.labels.good} (GP% ≥60% and Contract &gt;$5,000)
          </span>
        </div>
      ) : null}

      <div className="card" style={{ padding: "0.35rem 0 0.85rem" }}>
        {deleteMsg ? (
          <p style={{ margin: "0.75rem 1.25rem", color: "var(--warn)", fontSize: "0.86rem" }}>{deleteMsg}</p>
        ) : null}
        {recheckMsg ? (
          <p style={{ margin: "0.75rem 1.25rem", color: "var(--muted)", fontSize: "0.86rem" }}>{recheckMsg}</p>
        ) : null}
        {editMsg ? (
          <p style={{ margin: "0.75rem 1.25rem", color: "var(--muted)", fontSize: "0.86rem" }}>{editMsg}</p>
        ) : null}
        {visibleRows.length === 0 ? (
          <p style={{ margin: "1rem 1.25rem", color: "var(--muted)" }}>
            No jobs match. Widen search, pick another year, or turn on &quot;Show empty job # placeholders&quot; for
            pre-assigned numbers.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table table-data">
              <thead>
                <tr>
                  {cols.map((id) => renderTh(id))}
                  {canEdit ? <th style={{ minWidth: "10rem" }}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const rowStyle = canSeeGp ? rowStyleForHighlight(row) : undefined;
                  return (
                    <Fragment key={row.id}>
                      <tr style={rowStyle}>
                        {cols.map((id) => renderTd(row, id))}
                        {canEdit ? (
                          <td style={{ whiteSpace: "normal" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="btn secondary"
                              onClick={() => void recheckCommission(row)}
                              disabled={recheckingId === row.id || deletingId != null || savingEditId != null}
                              style={{ padding: "0.4rem 0.75rem" }}
                            >
                              {recheckingId === row.id ? "Rechecking…" : "Recheck commission"}
                            </button>
                            <button
                              type="button"
                              className="btn secondary"
                              onClick={() => beginEdit(row)}
                              disabled={deletingId != null || savingEditId != null || recheckingId != null}
                              style={{ padding: "0.4rem 0.75rem" }}
                            >
                              {editingId === row.id ? "Editing" : "Edit"}
                            </button>
                            <button
                              type="button"
                              className="btn secondary"
                              onClick={() => void deleteJob(row)}
                              disabled={deletingId === row.id || savingEditId != null || recheckingId != null}
                              style={{ borderColor: "rgba(239, 68, 68, 0.6)", color: "#fecaca", padding: "0.4rem 0.75rem" }}
                            >
                              {deletingId === row.id ? "Deleting…" : "Delete"}
                            </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                      {canEdit && editingId === row.id && editForm ? (
                        <tr>
                          <td colSpan={cols.length + 1} style={{ paddingTop: 0 }}>
                            <div className="card" style={{ margin: "0.35rem 0.7rem 0.8rem", padding: "0.9rem 1rem" }}>
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                                  gap: "0.65rem 0.8rem",
                                }}
                              >
                              <label>
                                Customer name
                                <input
                                  className="input"
                                  value={editForm.name}
                                  onChange={(e) => setEditForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                                  placeholder="Customer"
                                />
                              </label>
                              <label>
                                Lead #
                                <input
                                  className="input"
                                  value={editForm.leadNumber}
                                  onChange={(e) =>
                                    setEditForm((prev) => (prev ? { ...prev, leadNumber: e.target.value } : prev))
                                  }
                                  placeholder="Lead number"
                                />
                              </label>
                              <label>
                                Status
                                <input
                                  className="input"
                                  value={editForm.status}
                                  onChange={(e) => setEditForm((prev) => (prev ? { ...prev, status: e.target.value } : prev))}
                                  placeholder="Status"
                                />
                              </label>
                              <label>
                                Contract amount
                                <input
                                  className="input"
                                  inputMode="decimal"
                                  value={editForm.contractAmount}
                                  onChange={(e) =>
                                    setEditForm((prev) => (prev ? { ...prev, contractAmount: e.target.value } : prev))
                                  }
                                  placeholder="0.00"
                                />
                              </label>
                              <label>
                                Change orders
                                <input
                                  className="input"
                                  inputMode="decimal"
                                  value={editForm.changeOrders}
                                  onChange={(e) =>
                                    setEditForm((prev) => (prev ? { ...prev, changeOrders: e.target.value } : prev))
                                  }
                                  placeholder="0.00"
                                />
                              </label>
                              <label>
                                Invoiced total
                                <input
                                  className="input"
                                  inputMode="decimal"
                                  value={editForm.invoicedTotal}
                                  onChange={(e) =>
                                    setEditForm((prev) => (prev ? { ...prev, invoicedTotal: e.target.value } : prev))
                                  }
                                  placeholder="0.00"
                                />
                              </label>
                              {canEditPayments ? (
                                <label>
                                  Amount paid
                                  <input
                                    className="input"
                                    inputMode="decimal"
                                    value={editForm.amountPaid}
                                    onChange={(e) =>
                                      setEditForm((prev) => (prev ? { ...prev, amountPaid: e.target.value } : prev))
                                    }
                                    placeholder="0.00"
                                  />
                                </label>
                              ) : null}
                              <label>
                                Project revenue
                                <input
                                  className="input"
                                  inputMode="decimal"
                                  value={editForm.projectRevenue}
                                  onChange={(e) =>
                                    setEditForm((prev) => (prev ? { ...prev, projectRevenue: e.target.value } : prev))
                                  }
                                  placeholder="0.00"
                                />
                              </label>
                              {canEditPayments ? (
                                <>
                                  <label>
                                    Paid date
                                    <input
                                      className="input"
                                      type="date"
                                      value={editForm.paidDate}
                                      onChange={(e) =>
                                        setEditForm((prev) => (prev ? { ...prev, paidDate: e.target.value } : prev))
                                      }
                                    />
                                  </label>
                                  <label style={{ alignSelf: "end" }}>
                                    <span style={{ display: "block", marginBottom: "0.45rem" }}>Paid in full</span>
                                    <input
                                      type="checkbox"
                                      checked={editForm.paidInFull}
                                      onChange={(e) =>
                                        setEditForm((prev) => (prev ? { ...prev, paidInFull: e.target.checked } : prev))
                                      }
                                    />
                                  </label>
                                </>
                              ) : null}
                              <label>
                                Contract signed date
                                <input
                                  className="input"
                                  type="date"
                                  value={editForm.contractSignedAt}
                                  onChange={(e) =>
                                    setEditForm((prev) => (prev ? { ...prev, contractSignedAt: e.target.value } : prev))
                                  }
                                />
                              </label>
                              </div>
                              <div style={{ display: "flex", gap: "0.55rem", marginTop: "0.9rem" }}>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => void saveEdit(row)}
                                  disabled={savingEditId === row.id}
                                >
                                  {savingEditId === row.id ? "Saving…" : "Save changes"}
                                </button>
                                <button
                                  type="button"
                                  className="btn secondary"
                                  onClick={cancelEdit}
                                  disabled={savingEditId === row.id}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
