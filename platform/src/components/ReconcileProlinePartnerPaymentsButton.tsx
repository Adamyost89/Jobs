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
  status?: "running" | "done" | "error";
  runId?: string;
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
  message?: string;
};

type Props = {
  partnerConfigured: boolean;
};

const CLI_HINT =
  "cd /opt/elevated-sheets/platform && docker compose -f docker-compose.prod.yml exec app npm run proline:partner-reconcile";

function formatResult(apply: boolean, j: ReconcileResult): string {
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
  return `${apply ? "Applied" : "Dry run"}. Payments ${j.paymentsSeen ?? 0}, invoices ${j.invoicesSeen ?? 0}, matched jobs ${j.matchedJobs ?? 0}, unmatched payments ${j.unmatchedPayments ?? 0}, mismatches ${j.mismatches ?? 0}, events written ${j.paymentEventsWritten ?? 0}, updated ${j.updated ?? 0}.${diag}${sample}${extraErr}`;
}

async function parseJson(res: Response): Promise<ReconcileResult> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as ReconcileResult) : {};
  } catch {
    throw new Error(
      `HTTP ${res.status} — not JSON (proxy timeout?). Use server CLI: ${CLI_HINT}. Body: ${text.slice(0, 120)}`
    );
  }
}

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
    setMsg(apply ? "Starting Partner apply…" : "Starting Partner dry-run…");
    try {
      const startRes = await fetch("/api/integrations/proline/partner-reconcile-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply, includeInvoices: false, maxPages: 80 }),
      });
      const start = await parseJson(startRes);
      if (!startRes.ok || !start.runId) {
        setMsg(start.error || start.message || `Failed to start (HTTP ${startRes.status}).`);
        return;
      }

      const runId = start.runId;
      setMsg(`Running in background (${runId.slice(0, 8)}…) — safe past Cloudflare timeouts.`);

      const deadline = Date.now() + 45 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const pollRes = await fetch(
          `/api/integrations/proline/partner-reconcile-payments?runId=${encodeURIComponent(runId)}`
        );
        const j = await parseJson(pollRes);
        if (pollRes.status === 404) {
          setMsg("Run expired (app restarted?). Re-run dry-run, or use the server CLI.");
          return;
        }
        if (j.status === "running") {
          setMsg(`Still running (${runId.slice(0, 8)}…) — Partner rate limit ~1 call / 5s.`);
          continue;
        }
        if (j.status === "error" || j.ok === false) {
          setMsg(j.error || "Partner reconcile failed.");
          return;
        }
        setMsg(formatResult(apply, j));
        return;
      }
      setMsg(`Timed out waiting for background job. Check server logs, or run: ${CLI_HINT}`);
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
        Pull dated payments from the ProLine Partner API. Prefer dry run first. Runs in the background so Cloudflare
        won&apos;t 524. Nightly apply is handled by <code>partner-daily</code>. Rate-limited (~1 call / 5s). CLI:{" "}
        <code>{CLI_HINT}</code>
        {` `}(add <code>-- --apply</code> to write).
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
