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
    <div style={{ display: "grid", gap: "0.35rem", maxWidth: 240 }}>
      <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.25 }}>
        Admin correction for {salespersonName}:
      </p>
      <div className="page-actions-inline" style={{ alignItems: "stretch", gap: "0.35rem" }}>
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
              minWidth: "8rem",
            }}
            className="compact-field"
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
      {msg ? (
        <span style={{ fontSize: "0.78rem", color: "#f87171" }} role="alert">
          {msg}
        </span>
      ) : null}
    </div>
  );
}
