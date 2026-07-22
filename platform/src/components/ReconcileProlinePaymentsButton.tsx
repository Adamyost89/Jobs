"use client";

import { useState } from "react";

type PaymentMismatch = {
  jobNumber?: string;
  fields?: string[];
};

type ReconcileResult = {
  ok?: boolean;
  apply?: boolean;
  rowsSeen?: number;
  matchedJobs?: number;
  mismatches?: number;
  updated?: number;
  error?: string;
  errors?: string[];
  samples?: PaymentMismatch[];
};

export function ReconcileProlinePaymentsButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(apply: boolean) {
    if (busy) return;
    if (apply) {
      const ok = window.confirm(
        "Apply payment reconciliation from ProLine REST? This updates amount paid / paid date / paid in full on matching jobs."
      );
      if (!ok) return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/proline/reconcile-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const j = (await res.json().catch(() => ({}))) as ReconcileResult;
      if (!res.ok || j.ok === false) {
        const detail = j.error || (Array.isArray(j.errors) && j.errors[0]) || "Reconcile failed. ProLine REST may also be unavailable.";
        setMsg(detail);
        return;
      }
      const sample =
        Array.isArray(j.samples) && j.samples.length > 0
          ? ` Sample: ${j.samples
              .slice(0, 5)
              .map((s) => `${s.jobNumber ?? "?"} (${(s.fields ?? []).join(", ") || "fields"})`)
              .join("; ")}`
          : "";
      const extraErr =
        Array.isArray(j.errors) && j.errors.length > 0 ? ` Notes: ${j.errors.slice(0, 2).join("; ")}` : "";
      setMsg(
        `${apply ? "Applied" : "Dry run"}. Rows ${j.rowsSeen ?? 0}, matched ${j.matchedJobs ?? 0}, mismatches ${j.mismatches ?? 0}, updated ${j.updated ?? 0}.${sample}${extraErr}`
      );
    } catch {
      setMsg("Network error running payment reconcile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
        If ProLine&apos;s REST API still works while webhooks are down, pull payment fields for existing jobs. Prefer dry
        run first. Manual edits on Jobs still work either way.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="btn secondary" onClick={() => void run(false)} disabled={busy}>
          {busy ? "Working…" : "Dry-run reconcile payments"}
        </button>
        <button type="button" className="btn" onClick={() => void run(true)} disabled={busy}>
          {busy ? "Working…" : "Apply reconcile payments"}
        </button>
      </div>
      {msg ? <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>{msg}</p> : null}
    </div>
  );
}
