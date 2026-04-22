"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import type { FinancialMetricsAnalytics } from "@/lib/report-financial-metrics";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";
import { DrilldownTableRow } from "@/components/DrilldownTableRow";
import { formatUsd } from "@/lib/currency";

function workYearFromJobNumber(jn: string): number | undefined {
  const m = /^(\d{4})-/.exec(jn.trim());
  if (!m) return undefined;
  const y = parseInt(m[1], 10);
  return Number.isFinite(y) ? y : undefined;
}

function fmtMoneyChart(n: number) {
  const x = Number(n);
  return formatUsd(x);
}

function fmtUsdFull(n: number) {
  return formatUsd(n);
}

function fmtPctOrDash(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

function tickMoney(v: number) {
  return formatUsd(v);
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "rgba(15, 20, 25, 0.96)",
        border: "1px solid #2a3545",
        borderRadius: 8,
        padding: "0.65rem 0.85rem",
        fontSize: "0.82rem",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, color: "var(--text)" }}>{label}</div>
      {payload.map((p) => (
        <div
          key={p.name}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1.25rem",
            color: "#e8eef7",
            marginTop: 4,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
            {p.name}
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoneyChart(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

export function FinancialMetricsDashboard({ defaultYear }: { defaultYear: number }) {
  const router = useRouter();
  const [summaryYear, setSummaryYear] = useState(defaultYear);
  const [jobNumberDraft, setJobNumberDraft] = useState("");
  /** Job number sent to the API (updated via Refresh or “Cost history”) so typing does not refetch. */
  const [appliedJobNumber, setAppliedJobNumber] = useState("");
  const [data, setData] = useState<FinancialMetricsAnalytics | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const params = new URLSearchParams();
      params.set("summaryYear", String(summaryYear));
      const jn = appliedJobNumber.trim();
      if (jn) params.set("jobNumber", jn);
      const res = await fetch(`/api/reports/financial-metrics?${params}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const json = (await res.json()) as FinancialMetricsAnalytics;
      setData(json);
      setLoadState("idle");
    } catch (e) {
      setLoadState("error");
      setErrorMessage(e instanceof Error ? e.message : "Failed to load");
    }
  }, [summaryYear, appliedJobNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  const yearOptions = useMemo(() => {
    if (!data?.availableYears?.length) return [defaultYear];
    const set = new Set([...data.availableYears, defaultYear, summaryYear]);
    return [...set].sort((a, b) => a - b);
  }, [data?.availableYears, defaultYear, summaryYear]);

  const lineData = data?.yearlyTrend ?? [];
  const history = data?.jobCostHistory;

  const drillRepRowHref = useCallback(
    (salespersonId: string | null) =>
      jobsDrilldownUrl({ year: summaryYear, salespersonId: salespersonId ?? undefined }),
    [summaryYear]
  );

  const drillYearlyPoint = useCallback(
    (state: { activePayload?: readonly { payload?: { year?: number } }[] } | undefined) => {
      const y = state?.activePayload?.[0]?.payload?.year;
      if (typeof y === "number") void router.push(jobsDrilldownUrl({ year: y }));
    },
    [router]
  );

  return (
    <div className="page-stack" style={{ gap: "1.5rem" }}>
      <div className="card" style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem 1.25rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800 }}>Financial metrics</h2>
          <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
            {data?.scope === "mine" ? "Your jobs" : "Company-wide"} · cost, GP, invoicing by job year; optional cost edit
            history per job
          </span>
        </div>

        <div className="filter-bar" style={{ margin: 0 }}>
          <label>
            Rep summary year
            <select
              className="input input-narrow"
              value={summaryYear}
              onChange={(e) => setSummaryYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label style={{ minWidth: "12rem" }}>
            Job # (cost history)
            <input
              className="input"
              placeholder="e.g. 2024-001"
              value={jobNumberDraft}
              onChange={(e) => setJobNumberDraft(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </label>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setAppliedJobNumber(jobNumberDraft.trim());
            }}
            disabled={loadState === "loading"}
          >
            Cost history
          </button>
          <button type="button" className="btn secondary" onClick={() => void load()} disabled={loadState === "loading"}>
            Refresh
          </button>
        </div>

        {loadState === "error" && (
          <p style={{ margin: 0, color: "#f87171", fontSize: "0.9rem" }}>{errorMessage}</p>
        )}
        {loadState === "loading" && !data && (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>Loading metrics…</p>
        )}
      </div>

      {data && (
        <>
          <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>By job year</h3>
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
                Totals rolled up by each job&apos;s work year (contract + change orders = revenue). Year-over-year lines
                show how cost, GP, and invoiced dollars move with volume. Click the chart to open that job year on Jobs.
              </p>
            </div>
            <div style={{ width: "100%", height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }} onClick={drillYearlyPoint}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3545" />
                  <XAxis dataKey="year" tick={{ fill: "#8b9cb3", fontSize: 12 }} />
                  <YAxis tickFormatter={tickMoney} tick={{ fill: "#8b9cb3", fontSize: 11 }} width={56} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "0.8rem", color: "var(--muted)" }} />
                  <Line type="monotone" dataKey="totalRevenue" name="Revenue (contract+CO)" stroke="#3b82f6" strokeWidth={2} dot />
                  <Line type="monotone" dataKey="totalInvoiced" name="Invoiced" stroke="#eab308" strokeWidth={2} dot />
                  <Line type="monotone" dataKey="totalCost" name="Job cost" stroke="#f97316" strokeWidth={2} dot />
                  <Line type="monotone" dataKey="totalGp" name="GP" stroke="#22c55e" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {history && history.points.length > 0 && (
            <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
                  Cost edits · {history.jobNumber}
                </h3>
                <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
                  Points come from sheet imports (JOB_SHEET_SYNC) and in-app job saves that included cost. Older imports
                  may not have events until the next sheet sync.{" "}
                  <Link
                    href={jobsDrilldownUrl({
                      year: workYearFromJobNumber(history.jobNumber) ?? summaryYear,
                      q: history.jobNumber,
                    })}
                  >
                    Open job in Jobs list
                  </Link>
                </p>
              </div>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={history.points.map((p) => ({
                      t: new Date(p.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
                      cost: p.cost,
                    }))}
                    margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a3545" />
                    <XAxis dataKey="t" tick={{ fill: "#8b9cb3", fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={tickMoney} tick={{ fill: "#8b9cb3", fontSize: 11 }} width={56} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "0.8rem", color: "var(--muted)" }} />
                    <Line type="stepAfter" dataKey="cost" name="Recorded cost" stroke="#f97316" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {history && history.points.length === 0 && appliedJobNumber.trim() && (
            <div className="card" style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
              No cost-only API edits on file for <strong>{history.jobNumber}</strong>. The current sheet value still
              drives the rep summary and yearly totals above.{" "}
              <Link
                href={jobsDrilldownUrl({
                  year: workYearFromJobNumber(history.jobNumber) ?? summaryYear,
                  q: history.jobNumber,
                })}
              >
                Open job in Jobs list
              </Link>
            </div>
          )}

          <div className="card" style={{ display: "grid", gap: "0.75rem", overflow: "auto" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>By rep · {summaryYear}</h3>
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
                Rolled up for the selected job year. GP margin is GP divided by contract + change orders. Click a row to
                open that rep&apos;s jobs for {summaryYear}.
              </p>
            </div>
            <div>
              <table className="table table-data" style={{ minWidth: 880 }}>
                <thead>
                  <tr>
                    <th>Rep</th>
                    <th className="cell-num">Jobs</th>
                    <th className="cell-num">Revenue</th>
                    <th className="cell-num">Invoiced</th>
                    <th className="cell-num">Cost</th>
                    <th className="cell-num">GP</th>
                    <th className="cell-num">GP margin</th>
                    <th className="cell-num">Avg cost / job</th>
                  </tr>
                </thead>
                <tbody>
                  {data.repSummaries.map((r) => (
                    <DrilldownTableRow key={r.salespersonId ?? r.name} href={drillRepRowHref(r.salespersonId)}>
                      <td className="cell-strong">{r.name}</td>
                      <td className="cell-num">{r.jobCount}</td>
                      <td className="cell-num">{fmtUsdFull(r.totalRevenue)}</td>
                      <td className="cell-num">{fmtUsdFull(r.totalInvoiced)}</td>
                      <td className="cell-num">{fmtUsdFull(r.totalCost)}</td>
                      <td className="cell-num">{fmtUsdFull(r.totalGp)}</td>
                      <td className="cell-num">{fmtPctOrDash(r.gpMarginPct)}</td>
                      <td className="cell-num">{fmtUsdFull(r.avgCostPerJob)}</td>
                    </DrilldownTableRow>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
