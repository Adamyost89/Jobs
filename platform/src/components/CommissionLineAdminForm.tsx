"use client";

import { useState } from "react";

function parseNonNegativeMoney(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim().replace(/[$,]/g, "");
  if (trimmed === "") return { ok: false, error: "Enter a remaining owed amount." };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, error: "Enter a valid number." };
  if (n < 0) return { ok: false, error: "Amount cannot be negative." };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function CommissionLineAdminForm({
  commissionId,
  ledgerPaid,
  displayOwed,
  override: initialOverride,
  salespersonName,
}: {
  commissionId: string;
  ledgerPaid: number;
  displayOwed: number;
  override: boolean;
  salespersonName: string;
}) {
  const [amountStr, setAmountStr] = useState(() =>
    Number.isFinite(displayOwed) ? displayOwed.toFixed(2) : "0.00"
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/commissions/${commissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(typeof j.error === "string" ? j.error : "Request failed");
        return;
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  function adjustAndLock() {
    const parsed = parseNonNegativeMoney(amountStr);
    if (!parsed.ok) {
      setMsg(parsed.error);
      return;
    }
    patch({
      override: true,
      owedAmount: parsed.value,
      paidAmount: ledgerPaid,
    });
  }

  return (
    <div style={{ display: "grid", gap: "0.45rem", maxWidth: 240 }}>
      <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.45 }}>
        Wrong person/amount for this line (for example, {salespersonName})? <strong>Adjust amount &amp; lock</strong>{" "}
        saves the remaining owed you enter and freezes recalc. <strong>Clear lock &amp; recalc</strong> re-applies normal
        rules.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.72rem", color: "var(--muted)" }}>
          <span>Remaining owed ($)</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={busy}
            aria-label="Remaining owed amount to lock on this commission line"
            style={{
              padding: "0.35rem 0.5rem",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "var(--text)",
              minWidth: "6.5rem",
              fontSize: "0.82rem",
            }}
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={busy}
          style={{ fontSize: "0.78rem", alignSelf: "flex-end" }}
          onClick={adjustAndLock}
        >
          Adjust &amp; lock
        </button>
        {initialOverride ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            style={{ fontSize: "0.78rem", alignSelf: "flex-end" }}
            onClick={() => patch({ override: false })}
          >
            Clear &amp; recalc
          </button>
        ) : null}
      </div>
      {displayOwed > 0.005 && !initialOverride ? (
        <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
          Still owed {displayOwed.toLocaleString(undefined, { style: "currency", currency: "USD" })} - this only updates
          this commission row.
        </span>
      ) : null}
      {msg ? (
        <span style={{ fontSize: "0.78rem", color: "#f87171" }} role="alert">
          {msg}
        </span>
      ) : null}
    </div>
  );
}
