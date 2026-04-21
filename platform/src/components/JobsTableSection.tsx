"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";
import { JobCostEditor } from "@/components/JobCostEditor";
import { JobsDashboardPrefsForm } from "@/components/JobsDashboardPrefsForm";
import { JobPaidInFullToggle } from "@/components/JobPaidInFullToggle";
import { formatGpPercent, formatJobGpDisplay } from "@/lib/job-row-highlight";
import type { JobLike } from "@/lib/job-row-highlight";
import { hasDisplayableGp } from "@/lib/job-workflow";
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

export type JobsTableRowDTO = {
  id: string;
  jobNumber: string;
  year: number;
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

function rowRevenue(row: JobsTableRowDTO): number {
  if (row.projectRevenue > 0) return row.projectRevenue;
  if (row.invoicedTotal > 0) return row.invoicedTotal;
  return row.contractAmount + row.changeOrders;
}

function statusClass(s: string) {
  const u = s.toUpperCase();
  if (u === "UNKNOWN") return "status-pill status-pill--unknown";
  if (u.includes("CANCEL")) return "status-pill status-pill--bad";
  if (u.includes("COMPLETE") || u.includes("SOLD")) return "status-pill status-pill--done";
  return "status-pill status-pill--active";
}

function statusColumnLabel(row: JobsTableRowDTO): string {
  const stage = row.prolineStage?.trim();
  if (stage) return stage;
  return row.status.replace(/_/g, " ");
}

export function JobsTableSection({
  rows,
  user,
}: {
  rows: JobsTableRowDTO[];
  user: SessionUser;
}) {
  const router = useRouter();
  const canEdit = canEditJobs(user);
  const canSeeGp = canViewAllJobs(user);
  const [prefs, setPrefs] = useState<JobsTablePrefsV1>(DEFAULT_JOBS_TABLE_PREFS);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

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

  const money = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const money2 = (n: number) =>
    n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const h = prefs.highlights;
  const positiveBands = useMemo(
    () =>
      [
        { id: "good", label: h.labels.good, minGpPct: h.strongGpPct, colors: h.colors.good },
        { id: "medium", label: h.labels.medium, minGpPct: h.mediumGpPct, colors: h.colors.medium },
        ...h.extraBands.map((band) => ({
          id: band.id,
          label: band.label,
          minGpPct: band.minGpPct,
          colors: band.colors,
        })),
      ]
        .sort((a, b) => b.minGpPct - a.minGpPct)
        .filter((band, i, arr) => arr.findIndex((x) => x.id === band.id) === i),
    [h]
  );

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

    const status = row.status.toUpperCase();
    const gpPct = row.gpPercent;
    const rev = rowRevenue(row);

    if (status.includes("CANCEL")) return rowHighlightStyle(h.colors.warn);
    if (rev > h.minRevenue && (row.gp < 0 || (gpPct > 0 && gpPct < h.thinGpPct))) {
      return rowHighlightStyle(h.colors.bad);
    }
    if (rev > h.minRevenue) {
      const matchedBand = positiveBands.find((band) => gpPct >= band.minGpPct);
      if (matchedBand) return rowHighlightStyle(matchedBand.colors);
    }
    if (status.includes("COMPLETE") && gpPct >= h.completeMinGpPct) return rowHighlightStyle(h.colors.good);
    if (status.includes("IN_BILLING") && gpPct > 0 && gpPct < h.thinGpPct) {
      return rowHighlightStyle(h.colors.warn);
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
        return (
          <td key={id}>
            <span className={statusClass(row.status)}>{statusColumnLabel(row)}</span>
          </td>
        );
      case "contract":
        return <td key={id} className="cell-num">{money(row.contractAmount)}</td>;
      case "changeOrders":
        return <td key={id} className="cell-num">{money(row.changeOrders)}</td>;
      case "invoiced":
        return <td key={id} className="cell-num">{money(row.invoicedTotal)}</td>;
      case "amountPaid":
        return (
          <td key={id} className="cell-num">
            {row.amountPaid != null ? money2(row.amountPaid) : <span className="cell-muted">—</span>}
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
            {row.commPaid != null ? money2(row.commPaid) : <span className="cell-muted">—</span>}
          </td>
        );
      case "commOwed":
        return (
          <td key={id} className="cell-num">
            {row.commOwed != null ? money2(row.commOwed) : <span className="cell-muted">—</span>}
          </td>
        );
      default:
        return null;
    }
  }

  return (
    <div className="jobs-hl-vars">
      {canSeeGp ? <JobsDashboardPrefsForm prefs={prefs} onChange={persist} variant="jobs" /> : null}

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
          <strong style={{ color: "var(--text)" }}>Row colors</strong> (only when GP applies):{" "}
          {positiveBands.map((band, i) => (
            <span key={band.id}>
              {i > 0 ? <> · </> : null}
              <span className="row-legend" style={{ background: band.colors.legendBg, color: band.colors.legendText }}>
                {band.label} (GP% ≥{band.minGpPct}%)
              </span>
            </span>
          ))}{" "}
          ·{" "}
          <span className="row-legend" style={legendBad}>
            {h.labels.bad} (GP% &lt;{h.thinGpPct}% or loss)
          </span>{" "}
          ·{" "}
          <span className="row-legend" style={legendWarn}>
            {h.labels.warn}
          </span>
        </div>
      ) : null}

      <div className="card" style={{ padding: "0.35rem 0 0.85rem" }}>
        {deleteMsg ? (
          <p style={{ margin: "0.75rem 1.25rem", color: "var(--warn)", fontSize: "0.86rem" }}>{deleteMsg}</p>
        ) : null}
        {visibleRows.length === 0 ? (
          <p style={{ margin: "1rem 1.25rem", color: "var(--muted)" }}>
            No jobs match. Widen search, pick another year, or turn on &quot;Show empty job # placeholders&quot; for
            pre-assigned numbers.
          </p>
        ) : (
          <table className="table table-data">
            <thead>
              <tr>
                {cols.map((id) => renderTh(id))}
                {canEdit ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const rowStyle = canSeeGp ? rowStyleForHighlight(row) : undefined;
                return (
                  <tr key={row.id} style={rowStyle}>
                    {cols.map((id) => renderTd(row, id))}
                    {canEdit ? (
                      <td className="cell-nowrap">
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => void deleteJob(row)}
                          disabled={deletingId === row.id}
                          style={{ borderColor: "rgba(239, 68, 68, 0.6)", color: "#fecaca" }}
                        >
                          {deletingId === row.id ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
