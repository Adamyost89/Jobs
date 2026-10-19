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
        "Apply Partner API payment reconciliation? This updates amount paid / paid-in-full and writes dated payment history. Invoices are skipped here for speed — use the server CLI with --invoices if needed."
      );
      if (!ok) return;
    }
    setBusy(true);
    setMsg(
      apply
        ? "Applying Partner payments (this can take several minutes)…"
        : "Dry-running Partner payments (this can take several minutes)…"
    );
    try {
      const res = await fetch("/api/integrations/proline/partner-reconcile-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Skip invoices in the browser path to stay under proxy timeouts; payments + project alias map only.
        body: JSON.stringify({ apply, includeInvoices: false, maxPages: 80 }),
      });
      const text = await res.text();
      let j: ReconcileResult = {};
      try {
        j = text ? (JSON.parse(text) as ReconcileResult) : {};
      } catch {
        setMsg(
          `Partner reconcile failed (HTTP ${res.status}). Response was not JSON — often a proxy timeout. On the server run: cd /opt/elevated-sheets/platform && docker compose -f docker-compose.prod.yml exec app npm run proline:partner-reconcile${apply ? " -- --apply" : ""}. Body: ${text.slice(0, 180)}`
        );
        return;
      }
      if (!res.ok || j.ok === false) {
        const detail =
          j.error ||
          (Array.isArray(j.errors) && j.errors[0]) ||
          `Partner reconcile failed (HTTP ${res.status}).`;
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
        ? ` Match: ${d.paymentsWithProjectId ?? 0} payments had project id, ${d.paymentsWithoutProjectId ?? 0} missing, ${d.distinctPartnerProjectIds ?? 0} distinct partner ids, ${d.localJobsWithProlineId ?? 0} local jobs have prolineJobId, ${d.partnerProjectsLoaded ?? 0} partner projects loaded. Matched via id ${d.matchedBy?.prolineJobId ?? 0} / alias ${d.matchedBy?.projectAlias ?? 0} / lead# ${d.matchedBy?.leadNumber ?? 0}. Partner id samples: ${(d.samplePartnerProjectIds ?? []).slice(0, 3).join(", ") || "—"}. Local id samples: ${(d.sampleLocalProlineIds ?? []).slice(0, 3).join(", ") || "—"}. Project keys: ${(d.samplePartnerProjectKeys ?? []).slice(0, 10).join(", ") || "—"}.`
        : "";
      setMsg(
        `${apply ? "Applied" : "Dry run"}. Payments ${j.paymentsSeen ?? 0}, invoices ${j.invoicesSeen ?? 0}, matched jobs ${j.matchedJobs ?? 0}, unmatched payments ${j.unmatchedPayments ?? 0}, mismatches ${j.mismatches ?? 0}, events written ${j.paymentEventsWritten ?? 0}, updated ${j.updated ?? 0}.${diag}${sample}${extraErr}`
      );
    } catch (e) {
      setMsg(
        `Network/timeout error: ${e instanceof Error ? e.message : String(e)}. Prefer the server CLI: docker compose -f docker-compose.prod.yml exec app npm run proline:partner-reconcile`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
        Pull dated payments from the ProLine Partner API. Prefer dry run first. Rate-limited (~1 call / 5s). If the
        browser times out, run on the server:{" "}
        <code>npm run proline:partner-reconcile</code> (add <code>-- --apply</code> to write).
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
