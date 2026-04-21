"use client";

import { useState } from "react";

export function PayCommissionForm({
  commissionId,
  defaultOwed,
  suggestedPayPeriod,
}: {
  commissionId: string;
  defaultOwed: number;
  /** Current payroll window — pre-filled; user can override for corrections. */
  suggestedPayPeriod: string;
}) {
  const [payPeriod, setPayPeriod] = useState(suggestedPayPeriod);
  const [msg, setMsg] = useState<string | null>(null);

  async function pay() {
    setMsg(null);
    const trimmed = payPeriod.trim();
    const res = await fetch("/api/commissions/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commissionId,
        payPeriodLabel: trimmed || null,
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

  const periodMismatch = payPeriod.trim() !== suggestedPayPeriod.trim();

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.25 }}>
        Post check for period:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
        <input
          value={payPeriod}
          onChange={(e) => setPayPeriod(e.target.value)}
          title="Pay period label — default is the current payroll window"
          placeholder="Pay period"
          aria-label="Pay period label for this check"
          style={{
            padding: "0.4rem 0.55rem",
            borderRadius: 8,
            border: periodMismatch ? "1px solid #eab308" : "1px solid #334155",
            background: "#0f172a",
            color: "var(--text)",
            minWidth: 200,
            fontSize: "0.82rem",
          }}
        />
        <button className="btn" type="button" onClick={pay} disabled={defaultOwed <= 0} style={{ fontSize: "0.82rem" }}>
          Mark paid {defaultOwed.toFixed(2)}
        </button>
        {msg && <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{msg}</span>}
      </div>
      {periodMismatch && (
        <span style={{ fontSize: "0.72rem", color: "#fbbf24" }}>
          Pay period differs from the current window ({suggestedPayPeriod}).
        </span>
      )}
    </div>
  );
}
