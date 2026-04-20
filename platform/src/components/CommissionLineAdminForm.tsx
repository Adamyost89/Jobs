"use client";

import { useState } from "react";

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

  return (
    <div style={{ display: "grid", gap: "0.45rem", maxWidth: 280 }}>
      <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.45 }}>
        Mis-assigned line (e.g. {salespersonName} shouldn&apos;t earn on this job)?{" "}
        <strong>Zero &amp; lock</strong> stops auto-recalc from changing it.{" "}
        <strong>Clear lock &amp; recalc</strong> runs rules again — set the job&apos;s{" "}
        <em>Drew participation</em> to <code>No</code> first if Drew should drop off entirely.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
        <button
          type="button"
          className="btn"
          disabled={busy}
          style={{ fontSize: "0.78rem" }}
          onClick={() =>
            patch({
              override: true,
              owedAmount: 0,
              paidAmount: ledgerPaid,
            })
          }
        >
          Zero &amp; lock
        </button>
        {initialOverride ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            style={{ fontSize: "0.78rem" }}
            onClick={() => patch({ override: false })}
          >
            Clear lock &amp; recalc
          </button>
        ) : null}
      </div>
      {displayOwed > 0.005 && !initialOverride ? (
        <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
          Still owed {displayOwed.toLocaleString(undefined, { style: "currency", currency: "USD" })} — zeroing only
          affects the ledger row; use job import/API to set Drew participation if the sheet says he didn&apos;t
          participate.
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
