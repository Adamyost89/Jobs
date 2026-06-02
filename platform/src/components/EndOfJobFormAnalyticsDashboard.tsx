"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import type { EndOfJobFormAnalytics } from "@/lib/end-of-job-form-analytics";
import { formsListUrl } from "@/lib/forms-list-url";

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
];

function fmtPct(v: number | null) {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtDays(v: number | null) {
  if (v === null || !Number.isFinite(v)) return "—";
  return v < 1 ? "<1 day" : `${v.toFixed(1)} days`;
}

function drillHref(fieldId: string, valueLabel: string, sp?: string) {
  return formsListUrl({
    view: "submitted",
    eojField: fieldId,
    eojValue: valueLabel,
    sp,
  });
}

export function EndOfJobFormAnalyticsDashboard({
  defaultYear,
  canFilterByRep,
}: {
  defaultYear: number;
  canFilterByRep: boolean;
}) {
  const [year, setYear] = useState<string>(String(defaultYear));
  const [sp, setSp] = useState("");
  const [submittedFrom, setSubmittedFrom] = useState("");
  const [submittedTo, setSubmittedTo] = useState("");
  const [data, setData] = useState<EndOfJobFormAnalytics | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);
    const params = new URLSearchParams();
    if (year && year !== "all") params.set("year", year);
    if (canFilterByRep && sp) params.set("sp", sp);
    if (submittedFrom) params.set("submittedFrom", submittedFrom);
    if (submittedTo) params.set("submittedTo", submittedTo);
    try {
      const res = await fetch(`/api/forms/analytics?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : `Request failed (${res.status})`);
      }
      setData((await res.json()) as EndOfJobFormAnalytics);
      setLoadState("idle");
    } catch (e) {
      setLoadState("error");
      setErrorMessage(e instanceof Error ? e.message : "Failed to load");
    }
  }, [year, sp, submittedFrom, submittedTo, canFilterByRep]);

  useEffect(() => {
    void load();
  }, [load]);

  const yearOptions = useMemo(() => {
    const set = new Set<number>([defaultYear]);
    if (data?.availableYears) for (const y of data.availableYears) set.add(y);
    if (year !== "all") {
      const n = parseInt(year, 10);
      if (Number.isFinite(n)) set.add(n);
    }
    return ["all", ...[...set].sort((a, b) => b - a).map(String)];
  }, [data?.availableYears, defaultYear, year]);

  const repOptions = data?.salespersonOptions ?? [];

  const funnel = data?.funnel;

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <div className="card" style={{ display: "grid", gap: "1rem" }}>
        <div className="filter-bar" style={{ margin: 0 }}>
          <label>
            Job year
            <select className="input input-narrow" value={year} onChange={(e) => setYear(e.target.value)}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y === "all" ? "All years" : y}
                </option>
              ))}
            </select>
          </label>
          {canFilterByRep ? (
            <label>
              Rep
              <select className="input input-narrow" value={sp} onChange={(e) => setSp(e.target.value)}>
                <option value="">All reps</option>
                {repOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Submitted from
            <input
              className="input input-narrow"
              type="date"
              value={submittedFrom}
              onChange={(e) => setSubmittedFrom(e.target.value)}
            />
          </label>
          <label>
            Submitted to
            <input
              className="input input-narrow"
              type="date"
              value={submittedTo}
              onChange={(e) => setSubmittedTo(e.target.value)}
            />
          </label>
          <button type="button" className="btn" onClick={() => void load()} disabled={loadState === "loading"}>
            Apply
          </button>
        </div>
        {loadState === "error" ? (
          <p style={{ margin: 0, color: "#f87171", fontSize: "0.9rem" }}>{errorMessage}</p>
        ) : null}
        {loadState === "loading" && !data ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>Loading analytics…</p>
        ) : null}
      </div>

      {data && funnel ? (
        <>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
            {data.scope === "company" ? "Company-wide" : "Your jobs"}
            {data.year != null ? ` · job year ${data.year}` : " · all job years"}
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: "0.75rem",
            }}
          >
            {[
              { label: "Required", value: String(funnel.required) },
              { label: "Submitted", value: String(funnel.submitted) },
              { label: "Pending", value: String(funnel.pending) },
              { label: "Completion", value: fmtPct(funnel.completionRate) },
              { label: "Avg time to submit", value: fmtDays(funnel.avgDaysToSubmit) },
            ].map((c) => (
              <div key={c.label} className="card" style={{ padding: "0.85rem 1rem" }}>
                <div style={{ fontSize: "0.78rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {c.label}
                </div>
                <div style={{ fontSize: "1.35rem", fontWeight: 750, marginTop: 4 }}>{c.value}</div>
              </div>
            ))}
          </div>

          {data.submissionTrend.some((p) => p.count > 0) ? (
            <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
                Submissions by month
                {data.year != null ? ` (${data.year})` : ""}
              </h3>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.submissionTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a3545" />
                    <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(15, 20, 25, 0.96)",
                        border: "1px solid #2a3545",
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="count" name="Submissions" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}

          {data.selectFields.length === 0 &&
          data.booleanFields.length === 0 &&
          data.numberFields.length === 0 ? (
            <p className="card" style={{ margin: 0, color: "var(--muted)" }}>
              No checklist fields are configured yet, or no submitted responses match this filter. Add fields under
              Settings → End-of-job checklist form.
            </p>
          ) : null}

          {data.selectFields.map((sf) => {
            const chartData = sf.overall.length > 0 ? sf.overall : [{ label: "—", count: 0 }];
            const columnLabels = [...sf.options, "Other", "Unanswered"];
            return (
              <div key={sf.fieldId} className="card" style={{ display: "grid", gap: "1rem" }}>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{sf.label}</h3>
                <div style={{ width: "100%", height: Math.max(220, chartData.length * 36) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a3545" />
                      <XAxis type="number" allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={120}
                        tick={{ fill: "#e8eef7", fontSize: 12 }}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "rgba(15, 20, 25, 0.96)",
                          border: "1px solid #2a3545",
                          borderRadius: 8,
                        }}
                      />
                      <Bar dataKey="count" name="Jobs" radius={[0, 4, 4, 0]}>
                        {chartData.map((_, i) => (
                          <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                  Click a count to open matching submitted checklists.
                </p>
                <div className="table-responsive">
                  <table className="table table-data">
                    <thead>
                      <tr>
                        <th>Rep</th>
                        <th>Total</th>
                        {columnLabels.map((l) => (
                          <th key={l}>{l}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sf.byRep.map((row) => (
                        <tr key={`${row.salespersonId ?? "none"}-${row.repName}`}>
                          <td className="cell-nowrap">{row.repName}</td>
                          <td>{row.total}</td>
                          {columnLabels.map((label) => {
                            const bucket = row.counts.find((c) => c.label === label);
                            const count = bucket?.count ?? 0;
                            return (
                              <td key={label}>
                                {count > 0 ? (
                                  <Link
                                    href={drillHref(
                                      sf.fieldId,
                                      label,
                                      canFilterByRep && row.salespersonId ? row.salespersonId : sp || undefined
                                    )}
                                    style={{ fontVariantNumeric: "tabular-nums" }}
                                  >
                                    {count}
                                  </Link>
                                ) : (
                                  <span style={{ color: "var(--muted)" }}>0</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem", fontSize: "0.88rem" }}>
                  {sf.overall.map((b) =>
                    b.count > 0 ? (
                      <Link key={b.label} href={drillHref(sf.fieldId, b.label, sp || undefined)}>
                        {b.label}: <strong>{b.count}</strong>
                      </Link>
                    ) : null
                  )}
                </div>
              </div>
            );
          })}

          {data.booleanFields.map((bf) => (
            <div key={bf.fieldId} className="card" style={{ display: "grid", gap: "0.75rem" }}>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{bf.label}</h3>
              <p style={{ margin: 0, fontSize: "0.88rem" }}>
                Yes: <strong>{bf.overall.yes}</strong> · No: <strong>{bf.overall.no}</strong> · Unanswered:{" "}
                <strong>{bf.overall.unanswered}</strong>
              </p>
              {bf.byRep.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-data">
                    <thead>
                      <tr>
                        <th>Rep</th>
                        <th>Yes</th>
                        <th>No</th>
                        <th>Unanswered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bf.byRep.map((row) => (
                        <tr key={`${row.salespersonId ?? "none"}-${row.repName}`}>
                          <td>{row.repName}</td>
                          <td>{row.yes}</td>
                          <td>{row.no}</td>
                          <td>{row.unanswered}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ))}

          {data.numberFields
            .filter((nf) => nf.answered > 0)
            .map((nf) => (
              <div key={nf.fieldId} className="card">
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{nf.label}</h3>
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.88rem", color: "var(--muted)" }}>
                  Answered: {nf.answered} · Sum: {nf.sum.toLocaleString()} · Avg:{" "}
                  {nf.average != null ? nf.average.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                </p>
              </div>
            ))}

          {data.textFootnotes.length > 0 ? (
            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
              Text fields with responses:{" "}
              {data.textFootnotes.map((t) => `${t.label} (${t.answered})`).join(" · ")}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
