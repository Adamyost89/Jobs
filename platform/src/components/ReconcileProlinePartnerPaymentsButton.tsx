"use client";

import { useState } from "react";

type Sample = { jobNumber?: string; fields?: string[] };

type Diagnostics = {
  paymentsWithProjectId?: number;
  paymentsWithoutProjectId?: number;
  paymentsNormalizedFailed?: number;
  distinctPartnerProjectIds?: number;
  localJobsWithProlineId?: number;
  samplePartnerProjectIds?: string[];
  samplePartnerPaymentKeys?: string[];
  samplePartnerProjectKeys?: string[];
  sampleLocalProlineIds?: string[];
  partnerProjectsLoaded?: number;
  matchedBy?: { prolineJobId?: number; leadNumber?: number; projectAlias?: number };
};

type ReconcileResult = {
  ok?: boolean;
  apply?: boolean;
  paymentsSeen?: number;
  invoicesSeen?: number;
  matchedJobs?: number;
  unmatchedPayments?: number;
  paymentEventsWritten?: number;
  mismatches?: number;
  updated?: number;
  partnerConfigured?: boolean;
  error?: string;
  errors?: string[];
  samples?: Sample[];
  diagnostics?: Diagnostics;
};

type Props = {
  partnerConfigured: boolean;
};

export function ReconcileProlinePartnerPaymentsButton({ partnerConfigured }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(apply: boolean) {
    if (busy) return;
    if (!partnerConfigured) {
      setMsg("Set PROLINE_PARTNER_KEY and PROLINE_COMPANY_KEY on the server first.");
      return;
    }
    if (apply) {
      const ok = window.confirm(
        "Apply Partner API payment reconciliation? This updates amount paid / invoiced / paid-in-full and writes dated payment history for commission tiers."
      );
      if (!ok) return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/proline/partner-reconcile-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const j = (await res.json().catch(() => ({}))) as ReconcileResult;
      if (!res.ok || j.ok === false) {
        const detail =
          j.error || (Array.isArray(j.errors) && j.errors[0]) || "Partner reconcile failed.";
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
      const d = j.diagnostics;
      const diag = d
        ? ` Match: ${d.paymentsWithProjectId ?? 0} payments had project id, ${d.paymentsWithoutProjectId ?? 0} missing, ${d.distinctPartnerProjectIds ?? 0} distinct partner ids, ${d.localJobsWithProlineId ?? 0} local jobs have prolineJobId, ${d.partnerProjectsLoaded ?? 0} partner projects loaded. Matched via id ${d.matchedBy?.prolineJobId ?? 0} / alias ${d.matchedBy?.projectAlias ?? 0} / lead# ${d.matchedBy?.leadNumber ?? 0}. Partner id samples: ${(d.samplePartnerProjectIds ?? []).slice(0, 3).join(", ") || "—"}. Local id samples: ${(d.sampleLocalProlineIds ?? []).slice(0, 3).join(", ") || "—"}. Payment keys: ${(d.samplePartnerPaymentKeys ?? []).slice(0, 8).join(", ") || "—"}. Project keys: ${(d.samplePartnerProjectKeys ?? []).slice(0, 8).join(", ") || "—"}.`
        : "";
      setMsg(
        `${apply ? "Applied" : "Dry run"}. Payments ${j.paymentsSeen ?? 0}, invoices ${j.invoicesSeen ?? 0}, matched jobs ${j.matchedJobs ?? 0}, unmatched payments ${j.unmatchedPayments ?? 0}, mismatches ${j.mismatches ?? 0}, events written ${j.paymentEventsWritten ?? 0}, updated ${j.updated ?? 0}.${diag}${sample}${extraErr}`
      );
    } catch {
      setMsg("Network error running Partner payment reconcile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
        Pull dated payments (and invoices) from the ProLine Partner API. Prefer dry run first. Rate-limited (~1
        call / 5s), so large windows take a while. Webhooks stay the live path; this is the reliable backfill.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="btn secondary" onClick={() => void run(false)} disabled={busy || !partnerConfigured}>
          {busy ? "Working…" : "Dry-run Partner payments"}
        </button>
        <button type="button" className="btn" onClick={() => void run(true)} disabled={busy || !partnerConfigured}>
          {busy ? "Working…" : "Apply Partner payments"}
        </button>
      </div>
      {msg ? <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>{msg}</p> : null}
    </div>
  );
}
