"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  BarChart,
  Bar,
} from "recharts";
import type { SignedContractsAnalytics } from "@/lib/report-analytics";
import { chartMonthLabelToDrill } from "@/lib/contract-signed-month";
import { jobsDrilldownUrl } from "@/lib/jobs-drilldown-url";
import { DrilldownTableRow } from "@/components/DrilldownTableRow";
import { formatUsd } from "@/lib/currency";

/** Slate/gray last so “Other” / tail reps are muted, not mid-legend gray bars. */
const PALETTE = [
  "#3b82f6",
  "#a855f7",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#06b6d4",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#f43f5e",
  "#94a3b8",
  "#64748b",
];

/** Avoid $0 tooltips when stacks are only a few dollars (whole dollars hide cents). */
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

export function ReportsAnalyticsDashboard({ defaultYear }: { defaultYear: number }) {
  const router = useRouter();
  const [summaryYear, setSummaryYear] = useState(defaultYear);
  const [monthlyYear, setMonthlyYear] = useState(defaultYear);
  const [data, setData] = useState<SignedContractsAnalytics | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/reports/analytics?summaryYear=${summaryYear}&monthlyYear=${monthlyYear}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const json = (await res.json()) as SignedContractsAnalytics;
      setData(json);
      setLoadState("idle");
    } catch (e) {
      setLoadState("error");
      setErrorMessage(e instanceof Error ? e.message : "Failed to load");
    }
  }, [summaryYear, monthlyYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const yearOptions = useMemo(() => {
    if (!data?.availableYears?.length) return [defaultYear];
    const set = new Set([...data.availableYears, defaultYear, summaryYear, monthlyYear]);
    return [...set].sort((a, b) => a - b);
  }, [data?.availableYears, defaultYear, summaryYear, monthlyYear]);

  const stackKeys = useMemo(() => {
    if (!data) return [];
    const keys = [...data.monthlyTopRepNames];
    const hasOther = data.monthlyStacked.some((r) => Number(r.Other) > 0);
    if (hasOther) keys.push("Other");
    return keys;
  }, [data]);

  const grand = useMemo(() => {
    if (!data?.repSummaries.length) return null;
    const base = data.repSummaries.reduce(
      (a, r) => ({
        jobCount: a.jobCount + r.jobCount,
        contractAmt: a.contractAmt + r.contractAmt,
        changeOrders: a.changeOrders + r.changeOrders,
        total: a.total + r.total,
        gp: a.gp + r.gp,
        openJobs: a.openJobs + r.openJobs,
      }),
      { jobCount: 0, contractAmt: 0, changeOrders: 0, total: 0, gp: 0, openJobs: 0 }
    );
    let rw = 0;
    let rc = 0;
    let iw = 0;
    let ic = 0;
    for (const r of data.repSummaries) {
      if (r.retailPct != null && r.contractAmt > 0) {
        rw += r.retailPct * r.contractAmt;
        rc += r.contractAmt;
      }
      if (r.insurancePct != null && r.contractAmt > 0) {
        iw += r.insurancePct * r.contractAmt;
        ic += r.contractAmt;
      }
    }
    return {
      ...base,
      retailPct: rc > 0 ? rw / rc : null,
      insurancePct: ic > 0 ? iw / ic : null,
      gpPctOfTotal: base.total > 0.005 ? (base.gp / base.total) * 100 : null,
    };
  }, [data?.repSummaries]);

  const lineData = data?.yearlyTrend ?? [];

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

  const drillMonthlyBar = useCallback(
    (repKey: string, row: { monthLabel: string; [key: string]: string | number }) => {
      if (!data) return;
      const slice = chartMonthLabelToDrill(String(row.monthLabel));
      const spId = repKey === "Other" ? undefined : data.salespersonIdByRepName[repKey];
      void router.push(
        jobsDrilldownUrl({
          year: monthlyYear,
          salespersonId: spId,
          signedMonth: slice.signedMonth,
          signedUndated: slice.signedUndated,
        })
      );
    },
    [data, monthlyYear, router]
  );

  return (
    <div className="page-stack" style={{ gap: "1.5rem" }}>
      <div className="card" style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem 1.25rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800 }}>Signed contracts</h2>
          <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
            {data?.scope === "mine" ? "Your jobs" : "Company-wide"} · interactive charts (replaces dense Sheet legends)
          </span>
        </div>

        <div className="filter-bar" style={{ margin: 0 }}>
          <label>
            Summary table year
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
          <label>
            Monthly chart year
            <select
              className="input input-narrow"
              value={monthlyYear}
              onChange={(e) => setMonthlyYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={`m-${y}`} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn secondary" onClick={() => void load()} disabled={loadState === "loading"}>
            Refresh
          </button>
        </div>

        {loadState === "error" && (
          <p style={{ margin: 0, color: "#f87171", fontSize: "0.9rem" }}>{errorMessage}</p>
        )}
        {loadState === "loading" && !data && (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>Loading analytics…</p>
        )}
      </div>

      {data && (
        <>
          <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>By year</h3>
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
                Contract amount, change orders, total (contract + CO), and GP — grouped by job year. Click the chart to
                open that job year on Jobs.
              </p>
            </div>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={lineData}
                  margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                  onClick={drillYearlyPoint}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3545" />
                  <XAxis dataKey="year" tick={{ fill: "#8b9cb3", fontSize: 12 }} />
                  <YAxis tickFormatter={tickMoney} tick={{ fill: "#8b9cb3", fontSize: 11 }} width={56} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "0.8rem", color: "var(--muted)" }} />
                  <Line type="monotone" dataKey="contracts" name="Contracts" stroke="#3b82f6" strokeWidth={2} dot />
                  <Line type="monotone" dataKey="changeOrders" name="Change orders" stroke="#ef4444" strokeWidth={2} dot />
                  <Line type="monotone" dataKey="total" name="Total" stroke="#eab308" strokeWidth={2} dot />
                  <Line type="monotone" dataKey="gp" name="GP" stroke="#22c55e" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>Monthly dollars by rep</h3>
              <p
                style={{
                  margin: "0.35rem 0 0",
                  fontSize: "0.82rem",
                  color: "var(--muted)",
                  lineHeight: 1.5,
                  maxWidth: "72rem",
                  whiteSpace: "normal",
                  wordBreak: "break-word",
                }}
              >
                Stacked contract + change orders by calendar month ({data.monthlyChartTimeZone}). Top{" "}
                {data.monthlyTopRepNames.length} reps for {monthlyYear} by dollars in this chart; everyone else is{" "}
                <strong>Other</strong>.
                {data.jobsUndatedNoSignDate > 0 ? (
                  <>
                    {" "}
                    <strong>{data.jobsUndatedNoSignDate}</strong> job
                    {data.jobsUndatedNoSignDate === 1 ? " has" : "s have"} no contract signed date — those dollars are in
                    the <strong>Undated</strong> column (not the import month). Fill dates in the sheet and re-import;
                    the app keeps an existing sign date when the sheet date cell is blank.
                  </>
                ) : null}{" "}
                Click a stack segment to open matching jobs (month + rep, or rep bucket for <strong>Other</strong>).
              </p>
            </div>
            <div style={{ width: "100%", height: 360 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthlyStacked} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3545" />
                  <XAxis dataKey="monthLabel" tick={{ fill: "#8b9cb3", fontSize: 11 }} />
                  <YAxis domain={[0, "auto"]} tickFormatter={tickMoney} tick={{ fill: "#8b9cb3", fontSize: 11 }} width={68} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "0.75rem", color: "var(--muted)" }} />
                  {stackKeys.map((key, i) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      stackId="signed"
                      fill={PALETTE[i % PALETTE.length]}
                      name={key}
                      onClick={(row: unknown) => {
                        if (typeof row !== "object" || row === null) return;
                        const r = row as { monthLabel?: string };
                        if (typeof r.monthLabel !== "string") return;
                        drillMonthlyBar(key, r as { monthLabel: string; [key: string]: string | number });
                      }}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card" style={{ display: "grid", gap: "0.75rem", overflow: "auto" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>Account manager summary · {summaryYear}</h3>
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
                Open jobs = not yet paid in full. Averages are based on contract + change order total. Click a row to
                open that rep&apos;s jobs for {summaryYear}.
              </p>
            </div>
            <div>
              <table className="table table-data" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>Rep</th>
                    <th className="cell-num"># contracts</th>
                    <th className="cell-num">Contract amt</th>
                    <th className="cell-num">Change orders</th>
                    <th className="cell-num">Total</th>
                    <th className="cell-num">GP</th>
                    <th className="cell-num">Retail %</th>
                    <th className="cell-num">Insurance %</th>
                    <th className="cell-num">GP %</th>
                    <th className="cell-num">Avg / contract</th>
                    <th className="cell-num">Open jobs</th>
                  </tr>
                </thead>
                <tbody>
                  {data.repSummaries.map((r) => (
                    <DrilldownTableRow key={r.salespersonId ?? r.name} href={drillRepRowHref(r.salespersonId)}>
                      <td className="cell-strong">{r.name}</td>
                      <td className="cell-num">{r.jobCount}</td>
                      <td className="cell-num">{fmtUsdFull(r.contractAmt)}</td>
                      <td className="cell-num">{fmtUsdFull(r.changeOrders)}</td>
                      <td className="cell-num">{fmtUsdFull(r.total)}</td>
                      <td className="cell-num">{fmtUsdFull(r.gp)}</td>
                      <td className="cell-num">{fmtPctOrDash(r.retailPct)}</td>
                      <td className="cell-num">{fmtPctOrDash(r.insurancePct)}</td>
                      <td className="cell-num">{fmtPctOrDash(r.gpPctOfTotal)}</td>
                      <td className="cell-num">{fmtUsdFull(r.avgPerContract)}</td>
                      <td className="cell-num">{r.openJobs}</td>
                    </DrilldownTableRow>
                  ))}
                  {grand && (
                    <tr style={{ fontWeight: 800, background: "rgba(59, 130, 246, 0.08)" }}>
                      <td>Grand total</td>
                      <td className="cell-num">{grand.jobCount}</td>
                      <td className="cell-num">{fmtUsdFull(grand.contractAmt)}</td>
                      <td className="cell-num">{fmtUsdFull(grand.changeOrders)}</td>
                      <td className="cell-num">{fmtUsdFull(grand.total)}</td>
                      <td className="cell-num">{fmtUsdFull(grand.gp)}</td>
                      <td className="cell-num">{fmtPctOrDash(grand.retailPct)}</td>
                      <td className="cell-num">{fmtPctOrDash(grand.insurancePct)}</td>
                      <td className="cell-num">{fmtPctOrDash(grand.gpPctOfTotal)}</td>
                      <td className="cell-num">
                        {grand.jobCount ? fmtUsdFull(grand.total / grand.jobCount) : "—"}
                      </td>
                      <td className="cell-num">{grand.openJobs}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
