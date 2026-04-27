"use client";

import { useState } from "react";
import { getPayPeriodForPayday, parseIsoDateAtNoonUtc } from "@/lib/pay-period";

export function PayCommissionForm({
  commissionId,
  defaultOwed,
  suggestedPaydayIso,
}: {
  commissionId: string;
  defaultOwed: number;
  /** Default payday (YYYY-MM-DD). */
  suggestedPaydayIso: string;
}) {
  const [payday, setPayday] = useState(suggestedPaydayIso);
  const [msg, setMsg] = useState<string | null>(null);

  async function pay() {
    setMsg(null);
    const trimmed = payday.trim();
    const res = await fetch("/api/commissions/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commissionId,
        payday: trimmed || null,
        amount: defaultOwed > 0 ? defaultOwed : undefined,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error || "Failed");
      return;
    }
    setMsg("Recorded. Refresh page.");
    window.location.reload();
  }

  const paydayDate = parseIsoDateAtNoonUtc(payday);
  const resolvedPayPeriod = paydayDate ? getPayPeriodForPayday(paydayDate).label : null;
  const paydayChanged = payday.trim() !== suggestedPaydayIso.trim();

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.25 }}>
        Set payday:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
        <input
          type="date"
          value={payday}
          onChange={(e) => setPayday(e.target.value)}
          title="Payday date for this check"
          aria-label="Payday date for this check"
          style={{
            padding: "0.4rem 0.55rem",
            borderRadius: 8,
            border: paydayChanged ? "1px solid #eab308" : "1px solid #334155",
            background: "#0f172a",
            color: "var(--text)",
            minWidth: 200,
            fontSize: "0.82rem",
          }}
        />
        <button className="btn" type="button" onClick={pay} disabled={defaultOwed <= 0} style={{ fontSize: "0.82rem" }}>
          Mark paid {defaultOwed.toFixed(2)}
        </button>
        {resolvedPayPeriod ? (
          <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Pay period: {resolvedPayPeriod}</span>
        ) : (
          <span style={{ fontSize: "0.72rem", color: "#f59e0b" }}>Enter a valid payday date.</span>
        )}
        {msg && <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{msg}</span>}
      </div>
      {paydayChanged && (
        <span style={{ fontSize: "0.72rem", color: "#fbbf24" }}>
          Payday differs from default ({suggestedPaydayIso}).
        </span>
      )}
    </div>
  );
}
