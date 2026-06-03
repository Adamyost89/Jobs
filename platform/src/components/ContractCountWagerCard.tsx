"use client";

import { useCallback, useEffect, useState } from "react";
import { formatSeasonalYearsList } from "@/lib/contract-count-seasonal";
import {
  WAGER_PRIZE_COPY,
  WAGER_WORK_YEAR,
  WAGER_TIMELINE_END,
  WAGER_TIMELINE_START,
  formatWagerDate,
  timelinePosition,
  wagerBanterLine,
  wagerPersonQuip,
  wagerVictoryMessage,
  type WagerPersonStatus,
} from "@/lib/contract-count-wager";
import type { WagerCardPayload } from "@/lib/wager-card-data";

const CHIP_STYLE: Record<WagerPersonStatus, { background: string; color: string }> = {
  in_running: { background: "rgba(59, 130, 246, 0.2)", color: "#93c5fd" },
  needs_miracle: { background: "rgba(234, 179, 8, 0.18)", color: "#fde047" },
  called_it: { background: "rgba(34, 197, 94, 0.2)", color: "#86efac" },
  close_but_late: { background: "rgba(139, 156, 179, 0.2)", color: "var(--muted)" },
};

const REFRESH_MS = 60_000;

function money(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function pct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

type Props = {
  initial: WagerCardPayload;
};

export function ContractCountWagerCard({ initial }: Props) {
  const [payload, setPayload] = useState(initial);
  const snap = payload.snapshot;
  const seasonalYearsLabel =
    snap.seasonalBasisYears.length > 0 ? formatSeasonalYearsList(snap.seasonalBasisYears) : null;
  const banter = wagerBanterLine(snap);
  const victory = wagerVictoryMessage(snap);
  const oddsByName = new Map(snap.odds.map((o) => [o.name, o]));
  const pctProgress = Math.min(100, Math.round((snap.current / snap.target) * 1000) / 10);
  const remaining = Math.max(0, snap.target - snap.current);
  const todayPos = timelinePosition(snap.todayKey);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/wager", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as WagerCardPayload;
      setPayload(data);
    } catch {
      /* keep last good snapshot */
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(refresh, REFRESH_MS);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return (
    <div
      className="card"
      style={{
        padding: "1rem 1.15rem 1.1rem",
        borderColor: snap.reachedTarget ? "rgba(34, 197, 94, 0.45)" : undefined,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem", alignItems: "baseline" }}>
        <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 750 }}>Race to 232</h2>
        <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>Admin office pool — {WAGER_WORK_YEAR} work year</span>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)", marginLeft: "auto" }}>
          Through {formatWagerDate(snap.todayKey)} · refreshes live
        </span>
      </div>
      <p style={{ margin: "0.5rem 0 0", fontSize: "0.82rem", color: "var(--muted)", fontStyle: "italic", lineHeight: 1.45 }}>
        {WAGER_PRIZE_COPY}
      </p>
      {banter ? (
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--text)", lineHeight: 1.45, opacity: 0.92 }}>
          {banter}
        </p>
      ) : null}

      <div style={{ marginTop: "0.85rem", display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.35rem 0.75rem" }}>
        <span style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>
          {snap.current}
          <span style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--muted)" }}> / {snap.target}</span>
        </span>
        {!snap.reachedTarget ? (
          <span style={{ fontSize: "0.88rem", color: "var(--muted)" }}>{remaining} to go</span>
        ) : (
          <span style={{ fontSize: "0.88rem", color: "var(--good)", fontWeight: 650 }}>Target reached!</span>
        )}
      </div>

      <div
        role="progressbar"
        aria-valuenow={snap.current}
        aria-valuemin={0}
        aria-valuemax={snap.target}
        aria-label={`Signed contracts progress: ${snap.current} of ${snap.target}`}
        style={{
          marginTop: "0.65rem",
          height: 10,
          borderRadius: 999,
          background: "#2a3545",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pctProgress}%`,
            borderRadius: 999,
            background: snap.reachedTarget
              ? "linear-gradient(90deg, var(--good), #4ade80)"
              : "linear-gradient(90deg, var(--accent), #60a5fa)",
            transition: "width 0.35s ease",
          }}
        />
      </div>

      <div
        style={{
          marginTop: "0.85rem",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.65rem 1rem",
          fontSize: "0.82rem",
        }}
      >
        <div>
          <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginBottom: "0.15rem" }}>YTD signed revenue</div>
          <div style={{ fontWeight: 650 }}>{money(snap.ytd.revenue)}</div>
          {snap.ytd.avgRevenuePerPricedContract != null ? (
            <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: "0.1rem" }}>
              {money(snap.ytd.avgRevenuePerPricedContract)} avg / priced contract
            </div>
          ) : null}
        </div>
        <div>
          <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginBottom: "0.15rem" }}>YTD gross profit</div>
          <div style={{ fontWeight: 650 }}>
            {money(snap.ytd.gp)}
            {snap.ytd.gpRevenue > 0 ? (
              <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: "0.75rem" }}>
                {" "}
                ({pct((snap.ytd.gp / snap.ytd.gpRevenue) * 100)} margin)
              </span>
            ) : null}
          </div>
          {snap.ytd.avgGpPerPricedContract != null ? (
            <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: "0.1rem" }}>
              {money(snap.ytd.avgGpPerPricedContract)} avg GP / priced contract
            </div>
          ) : null}
        </div>
      </div>
      {snap.ytd.pendingRevenueCount > 0 ? (
        <p style={{ margin: "0.45rem 0 0", fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.45 }}>
          {snap.ytd.pendingRevenueCount} signed contract{snap.ytd.pendingRevenueCount === 1 ? "" : "s"} still at $0
          (usually insurance awaiting amount) — excluded from per-contract averages until priced.
        </p>
      ) : null}

      <div style={{ marginTop: "1.1rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.72rem",
            color: "var(--muted)",
            marginBottom: "0.35rem",
          }}
        >
          <span>{formatWagerDate(WAGER_TIMELINE_START)}</span>
          <span>{formatWagerDate(WAGER_TIMELINE_END)}</span>
        </div>
        <div style={{ position: "relative", height: 36, marginBottom: "0.25rem" }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 14,
              height: 4,
              borderRadius: 999,
              background: "#2a3545",
            }}
          />
          {!snap.reachedTarget ? (
            <div
              title={`Today (${formatWagerDate(snap.todayKey)})`}
              style={{
                position: "absolute",
                left: `${todayPos * 100}%`,
                top: 6,
                transform: "translateX(-50%)",
                width: 3,
                height: 20,
                borderRadius: 2,
                background: "var(--text)",
                boxShadow: "0 0 0 2px var(--panel)",
                zIndex: 2,
              }}
            />
          ) : null}
          {snap.rows.map((row) => {
            const pos = timelinePosition(row.dateKey);
            return (
              <div
                key={row.name}
                title={`${row.name}: ${formatWagerDate(row.dateKey)}`}
                style={{
                  position: "absolute",
                  left: `${pos * 100}%`,
                  top: 0,
                  transform: "translateX(-50%)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  zIndex: row.status === "called_it" ? 3 : 1,
                }}
              >
                <span
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    color: row.status === "called_it" ? "var(--good)" : "var(--muted)",
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.name.slice(0, 1)}
                </span>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    marginTop: 2,
                    background:
                      row.status === "called_it"
                        ? "var(--good)"
                        : row.status === "needs_miracle"
                          ? "var(--warn)"
                          : row.status === "close_but_late"
                            ? "#64748b"
                            : "var(--accent)",
                    border: "2px solid var(--panel)",
                  }}
                />
              </div>
            );
          })}
        </div>
        <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)" }}>
          {!snap.reachedTarget ? (
            <>White tick = today. Pins = each admin&apos;s pick date.</>
          ) : (
            <>Pins show where everyone guessed we&apos;d cross {snap.target}.</>
          )}
        </p>
      </div>

      <ul style={{ margin: "0.85rem 0 0", padding: 0, listStyle: "none", display: "grid", gap: "0.55rem" }}>
        {snap.rows.map((row) => {
          const chip = CHIP_STYLE[row.status];
          const quip = wagerPersonQuip(row, snap.todayKey);
          const odds = oddsByName.get(row.name);
          return (
            <li key={row.name} style={{ display: "grid", gap: "0.15rem" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "0.5rem 0.75rem",
                  fontSize: "0.88rem",
                }}
              >
                <span style={{ fontWeight: 650, minWidth: "3.5rem" }}>{row.name}</span>
                <span style={{ color: "var(--muted)", minWidth: "6.5rem" }}>{formatWagerDate(row.dateKey)}</span>
                {odds ? (
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {odds.probability.toFixed(1)}% win chance - {odds.quip}
                  </span>
                ) : null}
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 650,
                    padding: "0.15rem 0.5rem",
                    borderRadius: 999,
                    background: chip.background,
                    color: chip.color,
                  }}
                >
                  {row.statusLabel}
                </span>
              </div>
              {quip ? (
                <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic", paddingLeft: "0.1rem" }}>
                  {quip}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {seasonalYearsLabel && !snap.reachedTarget ? (
        <div
          style={{
            marginTop: "0.85rem",
            padding: "0.65rem 0.75rem",
            borderRadius: 8,
            background: "rgba(42, 53, 69, 0.55)",
            fontSize: "0.82rem",
            color: "var(--muted)",
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 650, color: "var(--text)", marginBottom: "0.35rem" }}>
            {WAGER_WORK_YEAR} forecast (seasonality from {seasonalYearsLabel})
          </div>
          {snap.estimatedYearTotal != null ? (
            <div>
              <strong>{snap.estimatedYearTotal.toLocaleString()}</strong> signed contracts
            </div>
          ) : null}
          {snap.estimatedYearRevenue != null ? (
            <div>
              <strong>{money(snap.estimatedYearRevenue)}</strong> signed revenue
              {snap.forecastAvgRevenuePerContract != null ? (
                <span style={{ opacity: 0.9 }}>
                  {" "}
                  ({money(snap.forecastAvgRevenuePerContract)} × {snap.estimatedYearTotal?.toLocaleString()} contracts)
                </span>
              ) : null}
            </div>
          ) : null}
          {snap.estimatedYearGp != null ? (
            <div>
              <strong>{money(snap.estimatedYearGp)}</strong> gross profit
              {snap.forecastAvgGpPerContract != null ? (
                <span style={{ opacity: 0.9 }}>
                  {" "}
                  ({money(snap.forecastAvgGpPerContract)} × {snap.estimatedYearTotal?.toLocaleString()} contracts)
                </span>
              ) : null}
              {snap.estimatedGpMarginPct != null ? (
                <span> ({pct(snap.estimatedGpMarginPct)} margin)</span>
              ) : null}
            </div>
          ) : null}
          <div style={{ marginTop: "0.35rem", fontSize: "0.78rem", opacity: 0.9 }}>
            Contract count uses seasonal pacing; revenue &amp; GP use per-contract averages from prior years,
            blended with priced jobs signed YTD (skips $0 insurance placeholders).
          </div>
        </div>
      ) : null}

      {snap.projectedHitDateKey && !snap.reachedTarget ? (
        <p style={{ margin: seasonalYearsLabel ? "0.55rem 0 0" : "0.75rem 0 0", fontSize: "0.82rem", color: "var(--muted)", lineHeight: 1.45 }}>
          {seasonalYearsLabel ? (
            <>
              At that seasonal pace, we&apos;d hit <strong>{snap.target}</strong> around{" "}
              <strong>{formatWagerDate(snap.projectedHitDateKey)}</strong>.
            </>
          ) : (
            <>
              At YTD pace (since Jan 1), we&apos;d hit <strong>{snap.target}</strong> around{" "}
              <strong>{formatWagerDate(snap.projectedHitDateKey)}</strong>.
            </>
          )}
        </p>
      ) : null}

      {snap.projectedHitDatePaceKey &&
      snap.projectedHitDateKey &&
      !snap.reachedTarget &&
      seasonalYearsLabel &&
      snap.projectedHitDatePaceKey !== snap.projectedHitDateKey ? (
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.45, opacity: 0.85 }}>
          (Flat Jan 1 pace, ignoring seasonality, would land around {formatWagerDate(snap.projectedHitDatePaceKey)}.)
        </p>
      ) : null}

      {victory ? (
        <p
          style={{
            margin: "0.85rem 0 0",
            fontSize: "0.92rem",
            color: "var(--good)",
            fontWeight: 650,
            lineHeight: 1.45,
          }}
        >
          {victory}
        </p>
      ) : null}
    </div>
  );
}
