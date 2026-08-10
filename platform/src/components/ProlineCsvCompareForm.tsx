"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DEFAULT_APPLY_FIELDS,
  type ProlineCsvCompareField,
  type ProlineCsvMismatch,
  type ProlineCsvMissingLocal,
  type ProlineCsvOrphanLocal,
} from "@/lib/proline-csv-compare";

type CompareResponse = {
  ok?: boolean;
  apply?: boolean;
  error?: string;
  rowsSeen?: number;
  matchedJobs?: number;
  mismatches?: number;
  updated?: number;
  missingLocalCount?: number;
  orphanLocalCount?: number;
  errors?: string[];
  samples?: ProlineCsvMismatch[];
  missingLocalSamples?: ProlineCsvMissingLocal[];
  orphanLocalSamples?: ProlineCsvOrphanLocal[];
};

const IDENTITY_FIELDS: ProlineCsvCompareField[] = [
  "leadNumber",
  "prolineJobId",
  "name",
  "jobNumber",
];

const MONEY_FIELDS: ProlineCsvCompareField[] = [
  "contractAmount",
  "cost",
  "costingComplete",
  "amountPaid",
  "invoicedTotal",
];

const FIELD_LABELS: Record<ProlineCsvCompareField, string> = {
  jobNumber: "Job #",
  leadNumber: "Lead / project #",
  prolineJobId: "ProLine ID",
  name: "Name",
  contractAmount: "Contract / approved",
  cost: "Cost",
  costingComplete: "Costing complete",
  amountPaid: "Amount paid (net revenue)",
  invoicedTotal: "Invoiced (gross revenue)",
};

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  return String(v);
}

export function ProlineCsvCompareForm() {
  const [file, setFile] = useState<File | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<ProlineCsvCompareField>>(
    () => new Set(DEFAULT_APPLY_FIELDS)
  );
  const [excludedJobIds, setExcludedJobIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResponse | null>(null);

  const fieldList = useMemo(() => [...selectedFields], [selectedFields]);

  const toggleField = useCallback((f: ProlineCsvCompareField) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }, []);

  const setCategory = useCallback((fields: ProlineCsvCompareField[], on: boolean) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      for (const f of fields) {
        if (on) next.add(f);
        else next.delete(f);
      }
      return next;
    });
  }, []);

  const toggleExclude = useCallback((jobId: string) => {
    setExcludedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }, []);

  const run = useCallback(
    async (apply: boolean) => {
      if (!file || busy) return;
      if (fieldList.length === 0) {
        setError("Select at least one field to compare.");
        return;
      }
      if (apply) {
        const ok = window.confirm(
          "Apply selected ProLine CSV field fixes to matching jobs? Prefer dry-run first. Job # updates are high-caution."
        );
        if (!ok) return;
      }
      setBusy(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("apply", apply ? "true" : "false");
        for (const f of fieldList) fd.append("fields", f);

        if (apply && result?.samples?.length) {
          const includeIds = result.samples
            .map((s) => s.jobId)
            .filter((id) => !excludedJobIds.has(id));
          if (includeIds.length === 0) {
            setError("All mismatch rows are skipped. Uncheck Skip on at least one row before apply.");
            setBusy(false);
            return;
          }
          for (const id of includeIds) fd.append("onlyJobIds", id);
        }

        const res = await fetch("/api/integrations/proline/compare-csv", {
          method: "POST",
          body: fd,
        });
        const j = (await res.json().catch(() => ({}))) as CompareResponse;
        if (!res.ok || j.ok === false) {
          setError(j.error || (Array.isArray(j.errors) && j.errors[0]) || "Compare failed.");
          return;
        }
        setResult(j);
        setExcludedJobIds(new Set());
      } catch {
        setError("Network error running ProLine CSV compare.");
      } finally {
        setBusy(false);
      }
    },
    [busy, excludedJobIds, fieldList, file, result]
  );

  const samples = result?.samples ?? [];
  const visibleSamples = samples.filter((s) => !excludedJobIds.has(s.jobId));

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
          Upload a ProLine <code>projects-export-*.csv</code>. Dry-run first to see identity and money
          mismatches, then apply selected field fixes to matching jobs. Unmatched CSV rows are reported
          only (no creates).
        </p>
        <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.9rem" }}>
          ProLine CSV
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setResult(null);
              setError(null);
              setExcludedJobIds(new Set());
            }}
          />
        </label>

        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem" }}>
          <legend style={{ fontSize: "0.85rem", padding: "0 0.35rem" }}>Fields to compare / apply</legend>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <button
              type="button"
              className="btn secondary"
              style={{ fontSize: "0.8rem" }}
              onClick={() => setCategory(IDENTITY_FIELDS.filter((f) => f !== "jobNumber"), true)}
              disabled={busy}
            >
              Identity defaults
            </button>
            <button
              type="button"
              className="btn secondary"
              style={{ fontSize: "0.8rem" }}
              onClick={() => setCategory(MONEY_FIELDS, true)}
              disabled={busy}
            >
              All money
            </button>
            <button
              type="button"
              className="btn secondary"
              style={{ fontSize: "0.8rem" }}
              onClick={() => setSelectedFields(new Set(DEFAULT_APPLY_FIELDS))}
              disabled={busy}
            >
              Reset defaults
            </button>
            <button
              type="button"
              className="btn secondary"
              style={{ fontSize: "0.8rem" }}
              onClick={() => setSelectedFields(new Set())}
              disabled={busy}
            >
              Clear
            </button>
          </div>
          <div style={{ display: "grid", gap: "0.65rem", gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.35rem" }}>Identity</div>
              {IDENTITY_FIELDS.map((f) => (
                <label key={f} style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.88rem" }}>
                  <input
                    type="checkbox"
                    checked={selectedFields.has(f)}
                    onChange={() => toggleField(f)}
                    disabled={busy}
                  />
                  {FIELD_LABELS[f]}
                  {f === "jobNumber" ? (
                    <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>(caution)</span>
                  ) : null}
                </label>
              ))}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.35rem" }}>Money</div>
              {MONEY_FIELDS.map((f) => (
                <label key={f} style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.88rem" }}>
                  <input
                    type="checkbox"
                    checked={selectedFields.has(f)}
                    onChange={() => toggleField(f)}
                    disabled={busy}
                  />
                  {FIELD_LABELS[f]}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn secondary"
            disabled={busy || !file}
            onClick={() => void run(false)}
          >
            {busy ? "Working…" : "Dry-run compare"}
          </button>
          <button type="button" className="btn" disabled={busy || !file} onClick={() => void run(true)}>
            {busy ? "Working…" : "Apply selected fields"}
          </button>
        </div>
        {error ? (
          <p style={{ margin: 0, color: "var(--danger, #b42318)", fontSize: "0.9rem" }}>{error}</p>
        ) : null}
      </div>

      {result ? (
        <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
            {result.apply ? "Applied" : "Dry-run"} results
          </h2>
          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            Rows {result.rowsSeen ?? 0}, matched {result.matchedJobs ?? 0}, mismatches{" "}
            {result.mismatches ?? 0}, updated {result.updated ?? 0}, missing local{" "}
            {result.missingLocalCount ?? 0}, orphan local {result.orphanLocalCount ?? 0}.
          </p>
          {Array.isArray(result.errors) && result.errors.length > 0 ? (
            <p style={{ margin: 0, color: "var(--danger, #b42318)", fontSize: "0.85rem" }}>
              {result.errors.slice(0, 5).join("; ")}
            </p>
          ) : null}

          {samples.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid var(--border)" }}>
                      Skip
                    </th>
                    <th style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid var(--border)" }}>
                      Job #
                    </th>
                    <th style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid var(--border)" }}>
                      Match
                    </th>
                    <th style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid var(--border)" }}>
                      Fields
                    </th>
                    <th style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid var(--border)" }}>
                      Diffs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((s) => (
                    <tr key={s.jobId} style={{ opacity: excludedJobIds.has(s.jobId) ? 0.45 : 1 }}>
                      <td style={{ padding: "0.35rem", verticalAlign: "top" }}>
                        <input
                          type="checkbox"
                          checked={excludedJobIds.has(s.jobId)}
                          onChange={() => toggleExclude(s.jobId)}
                          disabled={busy || !!result.apply}
                          title="Skip this row when applying"
                        />
                      </td>
                      <td style={{ padding: "0.35rem", verticalAlign: "top", whiteSpace: "nowrap" }}>
                        {s.jobNumber}
                      </td>
                      <td style={{ padding: "0.35rem", verticalAlign: "top" }}>{s.matchKey}</td>
                      <td style={{ padding: "0.35rem", verticalAlign: "top" }}>
                        {(s.fields ?? []).map((f) => FIELD_LABELS[f] ?? f).join(", ")}
                      </td>
                      <td style={{ padding: "0.35rem", verticalAlign: "top" }}>
                        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                          {(s.fields ?? []).map((f) => (
                            <li key={f}>
                              <strong>{FIELD_LABELS[f] ?? f}</strong>:{" "}
                              {formatVal(s.local?.[f as keyof typeof s.local])} →{" "}
                              {formatVal(s.remote?.[f as keyof typeof s.remote])}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {excludedJobIds.size > 0 ? (
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
                  {excludedJobIds.size} row(s) skipped on apply ({visibleSamples.length} will update).
                </p>
              ) : null}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--muted)" }}>
              No mismatches for the selected fields.
            </p>
          )}

          {(result.missingLocalSamples?.length ?? 0) > 0 ? (
            <details>
              <summary style={{ cursor: "pointer", fontSize: "0.9rem" }}>
                Missing local samples ({result.missingLocalCount})
              </summary>
              <ul style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                {(result.missingLocalSamples ?? []).map((m, i) => (
                  <li key={i}>
                    {m.name ?? "?"} — job {m.jobNumber ?? "—"}, lead {m.leadNumber ?? "—"}, id{" "}
                    {m.prolineJobId ?? "—"} (tried {m.matchAttempt})
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {(result.orphanLocalSamples?.length ?? 0) > 0 ? (
            <details>
              <summary style={{ cursor: "pointer", fontSize: "0.9rem" }}>
                Orphan local samples ({result.orphanLocalCount})
              </summary>
              <ul style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                {(result.orphanLocalSamples ?? []).map((o) => (
                  <li key={o.jobId}>
                    {o.jobNumber} — lead {o.leadNumber ?? "—"}, id {o.prolineJobId ?? "—"}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
