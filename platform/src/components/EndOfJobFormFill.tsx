"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isEndOfJobFieldVisible, type EndOfJobFormField } from "@/lib/end-of-job-form";

function emptyValueForField(f: EndOfJobFormField): string | boolean {
  return f.type === "boolean" ? false : "";
}

export function EndOfJobFormFill({
  jobId,
  jobNumber,
  fields,
  canSubmit,
}: {
  jobId: string;
  jobNumber: string;
  fields: EndOfJobFormField[];
  canSubmit: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const o: Record<string, string | boolean> = {};
    for (const f of fields) {
      o[f.id] = emptyValueForField(f);
    }
    return o;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function setFieldValue(fieldId: string, next: string | boolean) {
    setValues((prev) => {
      const updated: Record<string, string | boolean> = { ...prev, [fieldId]: next };
      // Clear dependents that become hidden after this change.
      for (const f of fields) {
        if (!f.showIf) continue;
        if (!isEndOfJobFieldVisible(f, updated, fields)) {
          updated[f.id] = emptyValueForField(f);
        }
      }
      return updated;
    });
  }

  const visibleFields = fields.filter((f) => isEndOfJobFieldVisible(f, values, fields));

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const body: Record<string, unknown> = {};
    for (const f of visibleFields) {
      const raw = values[f.id];
      if (f.type === "number") {
        body[f.id] = typeof raw === "string" ? raw.trim() : raw;
      } else if (f.type === "boolean") {
        body[f.id] = raw === true;
      } else {
        body[f.id] = typeof raw === "string" ? raw : "";
      }
    }
    try {
      const res = await fetch(`/api/jobs/${jobId}/end-of-job-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = Array.isArray(j.details) ? j.details.join("; ") : "";
        setError([j.error, details].filter(Boolean).join(" ") || "Submit failed");
        return;
      }
      if (j.alreadySubmitted) {
        setDone(true);
        router.refresh();
        return;
      }
      setDone(true);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="card" style={{ color: "var(--good)" }}>
        Checklist submitted for job <strong>{jobNumber}</strong>. Commission payouts can proceed when amounts are owed.
      </div>
    );
  }

  return (
    <div className="card" style={{ display: "grid", gap: "0.85rem", maxWidth: "36rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.15rem" }}>End-of-job checklist · {jobNumber}</h2>
      {visibleFields.map((f) => (
        <label key={f.id} style={{ display: "grid", gap: "0.35rem" }}>
          <span>
            {f.label}
            {f.required ? <span style={{ color: "salmon" }}> *</span> : null}
          </span>
          {f.type === "textarea" ? (
            <textarea
              className="input"
              rows={4}
              value={String(values[f.id] ?? "")}
              disabled={!canSubmit}
              onChange={(e) => setFieldValue(f.id, e.target.value)}
            />
          ) : f.type === "boolean" ? (
            <input
              type="checkbox"
              checked={values[f.id] === true}
              disabled={!canSubmit}
              onChange={(e) => setFieldValue(f.id, e.target.checked)}
            />
          ) : f.type === "select" ? (
            <select
              className="input"
              value={String(values[f.id] ?? "")}
              disabled={!canSubmit}
              onChange={(e) => setFieldValue(f.id, e.target.value)}
            >
              <option value="">—</option>
              {(f.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              type={f.type === "number" ? "number" : "text"}
              value={String(values[f.id] ?? "")}
              disabled={!canSubmit}
              onChange={(e) => setFieldValue(f.id, e.target.value)}
            />
          )}
        </label>
      ))}
      {error ? <p style={{ margin: 0, color: "salmon" }}>{error}</p> : null}
      {canSubmit ? (
        <button type="button" className="btn" disabled={submitting || fields.length === 0} onClick={() => void submit()}>
          {submitting ? "Submitting…" : "Submit checklist"}
        </button>
      ) : (
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
          You can view this page but only the assigned rep or an admin can submit.
        </p>
      )}
    </div>
  );
}
