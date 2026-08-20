import { formatUsd } from "@/lib/currency";
import { formatPctOrDash } from "@/lib/am-summary";
import type { PaceProjection } from "@/lib/pace";
import { CONTRACT_SIGN_MONTH_LABELS } from "@/lib/contract-signed-month";

function money0(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtCount(n: number) {
  return Math.round(n).toLocaleString();
}

function MetricTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        padding: "0.75rem 0.9rem",
        borderRadius: 10,
        background: "rgba(10, 14, 18, 0.45)",
        border: "1px solid #2a3545",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 600, letterSpacing: "0.02em" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: "1.25rem",
          fontWeight: 750,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--muted)" }}>{sub}</div>
      ) : null}
    </div>
  );
}

export function PaceSection({ pace }: { pace: PaceProjection }) {
  const monthLabel =
    pace.asOfMonth >= 1 && pace.asOfMonth <= 12
      ? CONTRACT_SIGN_MONTH_LABELS[pace.asOfMonth - 1]
      : "—";

  const title = pace.isFinal
    ? `Pace — ${pace.workYear} final`
    : pace.isFutureYear
      ? `Pace — ${pace.workYear}`
      : `Pace — ${pace.workYear} projected`;

  const sharePct = (pace.expectedShareComplete * 100).toFixed(0);
  const busiest = [...pace.monthWeights].sort((a, b) => b.share - a.share).slice(0, 3);
  const slowest = [...pace.monthWeights].sort((a, b) => a.share - b.share).slice(0, 2);

  return (
    <div className="card" style={{ padding: "0.35rem 0 0.95rem" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.5rem 1.25rem",
          margin: "0.65rem 1rem 0.35rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{title}</h2>
        {!pace.isFutureYear && !pace.isFinal ? (
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Through {monthLabel} ({sharePct}% of typical year by volume)
          </span>
        ) : null}
      </div>

      <p style={{ margin: "0 1rem 0.85rem", fontSize: "0.8rem", color: "var(--muted)", lineHeight: 1.45, maxWidth: 920 }}>
        {pace.isFutureYear ? (
          <>No signed activity yet for {pace.workYear}.</>
        ) : pace.isFinal ? (
          <>
            Full-year signed totals for {pace.workYear}
            {pace.seasonalityYearsUsed > 0
              ? ` (seasonality from ${pace.seasonalityYearsUsed} prior year${pace.seasonalityYearsUsed === 1 ? "" : "s"}).`
              : "."}
          </>
        ) : (
          <>
            Year-end projection from YTD signed contracts, historical busy/slow months
            {pace.seasonalityYearsUsed > 0
              ? ` (${pace.seasonalityYearsUsed} prior year${pace.seasonalityYearsUsed === 1 ? "" : "s"})`
              : ""}
            , and each account manager&apos;s historical averages (partial start/end years are
            annualized from first→last signed month). Volume (# / $) follows YTD seasonality pace
            and only uses history as a floor when behind; avg / contract and GP% still blend toward
            historical means. Profit = projected signed $ × blended GP%.
          </>
        )}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.65rem",
          margin: "0 1rem 0.85rem",
        }}
      >
        <MetricTile
          label="Signed contracts"
          value={fmtCount(pace.projected.jobCount)}
          sub={pace.isFinal ? undefined : `YTD ${fmtCount(pace.ytd.jobCount)}`}
        />
        <MetricTile
          label="Signed $"
          value={money0(pace.projected.total)}
          sub={pace.isFinal ? undefined : `YTD ${money0(pace.ytd.total)}`}
        />
        <MetricTile
          label="GP %"
          value={formatPctOrDash(pace.projected.gpPct)}
          sub={
            pace.ytd.gpPct != null && !pace.isFinal
              ? `YTD ${formatPctOrDash(pace.ytd.gpPct)}`
              : undefined
          }
        />
        <MetricTile
          label="Profit"
          value={money0(pace.projected.profit)}
          sub={pace.isFinal ? undefined : `YTD ${money0(pace.ytd.profit)}`}
        />
        <MetricTile
          label="Avg / contract"
          value={formatUsd(pace.projected.avgPerContract)}
          sub={pace.isFinal ? undefined : `YTD ${formatUsd(pace.ytd.avgPerContract)}`}
        />
      </div>

      {!pace.isFutureYear && pace.seasonalityYearsUsed > 0 ? (
        <p style={{ margin: "0 1rem 0.75rem", fontSize: "0.78rem", color: "var(--muted)" }}>
          Typically busiest: {busiest.map((m) => m.label).join(", ")}
          {" · "}
          Slowest: {slowest.map((m) => m.label).join(", ")}
        </p>
      ) : null}

      {pace.amRows.length > 0 && !pace.isFutureYear ? (
        <div className="table-responsive">
          <table className="table table-data" style={{ fontSize: "0.85rem" }}>
            <thead>
              <tr>
                <th>AM</th>
                <th className="cell-num">YTD #</th>
                <th className="cell-num">YTD $</th>
                <th className="cell-num">{pace.isFinal ? "Final #" : "Proj #"}</th>
                <th className="cell-num">{pace.isFinal ? "Final $" : "Proj $"}</th>
                <th className="cell-num">Hist. avg $/yr</th>
                <th className="cell-num">Hist. avg / contract</th>
                <th className="cell-num">Proj GP%</th>
                <th className="cell-num">Proj profit</th>
                <th className="cell-num">Proj avg</th>
              </tr>
            </thead>
            <tbody>
              {pace.amRows.map((r) => (
                <tr key={r.name}>
                  <td className="cell-strong">{r.name}</td>
                  <td className="cell-num">{fmtCount(r.ytd.jobCount)}</td>
                  <td className="cell-num">{formatUsd(r.ytd.total)}</td>
                  <td className="cell-num">{fmtCount(r.projected.jobCount)}</td>
                  <td className="cell-num">{formatUsd(r.projected.total)}</td>
                  <td className="cell-num">
                    {r.historicalYearsUsed > 0 ? formatUsd(r.historicalAvgAnnualTotal) : "—"}
                  </td>
                  <td className="cell-num">
                    {r.historicalAvgPerContract > 0.005 ? formatUsd(r.historicalAvgPerContract) : "—"}
                  </td>
                  <td className="cell-num">{formatPctOrDash(r.projected.gpPct)}</td>
                  <td className="cell-num">{formatUsd(r.projected.profit)}</td>
                  <td className="cell-num">{formatUsd(r.projected.avgPerContract)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, background: "var(--card-border, rgba(0,0,0,0.06))" }}>
                <td>Company</td>
                <td className="cell-num">{fmtCount(pace.ytd.jobCount)}</td>
                <td className="cell-num">{formatUsd(pace.ytd.total)}</td>
                <td className="cell-num">{fmtCount(pace.projected.jobCount)}</td>
                <td className="cell-num">{formatUsd(pace.projected.total)}</td>
                <td className="cell-num">—</td>
                <td className="cell-num">—</td>
                <td className="cell-num">{formatPctOrDash(pace.projected.gpPct)}</td>
                <td className="cell-num">{formatUsd(pace.projected.profit)}</td>
                <td className="cell-num">{formatUsd(pace.projected.avgPerContract)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
