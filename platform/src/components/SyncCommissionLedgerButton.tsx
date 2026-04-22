"use client";

import { useState } from "react";

export function SyncCommissionLedgerButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function runSync() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/commissions/sync-ledger", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        scanned?: number;
        updated?: number;
        error?: string;
      };
      if (!res.ok) {
        setMsg(j.error || "Failed to sync commission ledger.");
        return;
      }
      setMsg(`Synced. Updated ${j.updated ?? 0} of ${j.scanned ?? 0} commission rows.`);
    } catch {
      setMsg("Network error running ledger sync.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <button className="btn" type="button" onClick={runSync} disabled={busy}>
        {busy ? "Syncing..." : "Sync payout rows into commission ledger"}
      </button>
      {msg ? <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>{msg}</p> : null}
    </div>
  );
}
