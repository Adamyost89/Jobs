"use client";

import { useState } from "react";

type ExplainPayload = {
  commissionId: string;
  salespersonName: string;
  jobNumber: string;
  year: number;
  leadNumber: string | null;
  explain: {
    reason: string;
    rate: number;
    rateReason: string;
    basis: number;
    customerPaid: number;
    commissionableTotal: number;
    paymentProgress: number;
    collectedCommissionBase: number;
    totalCommissionAtRate: number;
    earnedToDate: number;
    alreadyPaidCommission: number;
    owed: number;
    elevatedPaidGuard: {
      enabled: boolean;
      triggered: boolean;
      legacyRate: number;
      legacyCommission: number;
    };
  };
  storedLine: {
    ledgerPaid: number;
    ledgerOwed: number;
    payoutSum: number;
    displayPaid: number;
    displayOwed: number;
    override: boolean;
    salespersonActive: boolean;
  };
};

function money2(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

export function CommissionExplainButton({ commissionId }: { commissionId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExplainPayload | null>(null);

  async function loadIfNeeded(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen || data || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/commissions/${commissionId}/explain`);
      const j = (await res.json().catch(() => ({}))) as ExplainPayload & { error?: string };
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "Failed to load calculation details.");
        return;
      }
      setData(j);
    } catch {
      setError("Network error loading calculation details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <details open={open} onToggle={(e) => void loadIfNeeded((e.currentTarget as HTMLDetailsElement).open)}>
      <summary style={{ cursor: "pointer", fontSize: "0.82rem", color: "var(--muted)" }}>Explain amount</summary>
      <div style={{ marginTop: "0.45rem", display: "grid", gap: "0.35rem", fontSize: "0.78rem", lineHeight: 1.45 }}>
        {loading ? <span className="cell-muted">Loading calculation trace…</span> : null}
        {error ? <span style={{ color: "#fca5a5" }}>{error}</span> : null}
        {data ? (
          <>
            <span>
              Job {data.jobNumber} · {data.year}
              {data.leadNumber ? ` · Lead ${data.leadNumber}` : ""} · {data.salespersonName}
            </span>
            <span>Reason: {data.explain.reason}</span>
            <span>Rate: {pct(data.explain.rate)} ({data.explain.rateReason})</span>
            <span>
              Payment progress: {money2(data.explain.customerPaid)} / {money2(data.explain.commissionableTotal)} ={" "}
              {pct(data.explain.paymentProgress)}
            </span>
            <span>
              Earned to date: {money2(data.explain.collectedCommissionBase)} × {pct(data.explain.rate)} ={" "}
              {money2(data.explain.earnedToDate)}
            </span>
            <span>
              Owed formula: max(0, earned {money2(data.explain.earnedToDate)} − already paid{" "}
              {money2(data.explain.alreadyPaidCommission)}) = {money2(data.explain.owed)}
            </span>
            {data.explain.elevatedPaidGuard.enabled ? (
              <span>
                Elevated guard: {data.explain.elevatedPaidGuard.triggered ? "triggered" : "not triggered"} (legacy{" "}
                {pct(data.explain.elevatedPaidGuard.legacyRate)} ={" "}
                {money2(data.explain.elevatedPaidGuard.legacyCommission)})
              </span>
            ) : null}
            <span>
              Stored line now: ledger paid {money2(data.storedLine.ledgerPaid)} · ledger owed {money2(data.storedLine.ledgerOwed)}
              {" "}· checks {money2(data.storedLine.payoutSum)} · shown owed {money2(data.storedLine.displayOwed)}
            </span>
            {data.storedLine.override ? <span>Line is override-locked.</span> : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
