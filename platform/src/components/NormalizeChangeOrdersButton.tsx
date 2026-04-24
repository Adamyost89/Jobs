"use client";

import { useState } from "react";

export function NormalizeChangeOrdersButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function runNormalize() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/jobs/normalize-change-orders", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        scanned?: number;
        matched?: number;
        updated?: number;
        error?: string;
      };
      if (!res.ok) {
        setMsg(j.error || "Failed to normalize change orders.");
        return;
      }
      setMsg(
        `Normalization complete. Updated ${j.updated ?? 0} of ${j.matched ?? 0} matched rows (scanned ${j.scanned ?? 0}).`
      );
    } catch {
      setMsg("Network error running normalization.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: "grid", gap: "0.5rem" }}>
      <div style={{ display: "grid", gap: "0.2rem" }}>
        <strong style={{ fontSize: "0.9rem" }}>Super Admin cleanup</strong>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
          Force <code>changeOrders = 0</code> when <code>amountPaid</code> equals <code>contractAmount</code>.
        </p>
      </div>
      <div>
        <button className="btn" type="button" onClick={runNormalize} disabled={busy}>
          {busy ? "Running cleanup..." : "Run change-order cleanup"}
        </button>
      </div>
      {msg ? <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>{msg}</p> : null}
    </div>
  );
}
