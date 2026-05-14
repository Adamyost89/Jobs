"use client";

import { useCallback, useEffect, useState } from "react";
import type { EndOfJobFormConfig, EndOfJobFormField, EndOfJobFormFieldType, EndOfJobFormTriggerConfig } from "@/lib/end-of-job-form";

const FIELD_TYPES: EndOfJobFormFieldType[] = ["text", "textarea", "number", "boolean", "select"];

export function EndOfJobFormSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<EndOfJobFormTriggerConfig>({
    match: "substring",
    value: "End of Job Checklist",
  });
  const [version, setVersion] = useState(1);
  const [fields, setFields] = useState<EndOfJobFormField[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/end-of-job-form-settings");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(typeof j.error === "string" ? j.error : "Load failed");
        return;
      }
      setTrigger(j.endOfJobFormTrigger ?? { match: "substring", value: "End of Job Checklist" });
      const f = j.endOfJobForm as EndOfJobFormConfig | undefined;
      setVersion(typeof f?.version === "number" ? f.version : 1);
      setFields(Array.isArray(f?.fields) ? f.fields : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const body = {
        endOfJobFormTrigger: trigger,
        endOfJobForm: { version, fields },
      };
      const res = await fetch("/api/admin/end-of-job-form-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(typeof j.error === "string" ? j.error : "Save failed");
        return;
      }
      setMsg("Saved.");
    } finally {
      setSaving(false);
    }
  }

  function addField() {
    setFields((prev) => [
      ...prev,
      { id: `field_${prev.length + 1}`, label: "New question", type: "text", required: false },
    ]);
  }

  function updateField(i: number, patch: Partial<EndOfJobFormField>) {
    setFields((prev) => {
      const next = [...prev];
      const cur = next[i];
      if (!cur) return prev;
      next[i] = { ...cur, ...patch };
      if (patch.type && patch.type !== "select") {
        const { options: _o, ...rest } = next[i];
        next[i] = rest as EndOfJobFormField;
      }
      return next;
    });
  }

  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
  }

  if (loading) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>End-of-job checklist form</h2>
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
      <h2 style={{ marginTop: 0 }}>End-of-job checklist form</h2>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
        When a job&apos;s ProLine pipeline stage matches the trigger, reps must submit this checklist before commission
        payouts appear on the Commissions page. Configure the Zapier Catch Hook URL in{" "}
        <code>END_OF_JOB_FORM_ZAP_URL</code> (optional secret: <code>END_OF_JOB_FORM_ZAP_SECRET</code>).
      </p>

      <div style={{ display: "grid", gap: "0.5rem", maxWidth: "32rem" }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span>Trigger match</span>
          <select
            className="input"
            value={trigger.match}
            onChange={(e) =>
              setTrigger((t) => ({ ...t, match: e.target.value === "exact" ? "exact" : "substring" }))
            }
          >
            <option value="substring">Substring (case-insensitive)</option>
            <option value="exact">Exact (case-insensitive)</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span>Trigger value (compared to ProLine stage)</span>
          <input
            className="input"
            value={trigger.value}
            onChange={(e) => setTrigger((t) => ({ ...t, value: e.target.value }))}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span>Form schema version (integer)</span>
          <input
            className="input"
            type="number"
            min={1}
            value={version}
            onChange={(e) => setVersion(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="btn secondary" onClick={addField}>
          Add field
        </button>
      </div>

      <div style={{ display: "grid", gap: "0.65rem" }}>
        {fields.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)" }}>No fields yet — add at least one before reps can submit.</p>
        ) : (
          fields.map((f, i) => (
            <div
              key={`${f.id}-${i}`}
              style={{
                border: "1px solid var(--border, rgba(255,255,255,0.12))",
                borderRadius: 8,
                padding: "0.65rem 0.75rem",
                display: "grid",
                gap: "0.5rem",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "end" }}>
                <label style={{ display: "grid", gap: "0.2rem", minWidth: "8rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Field id (stable key)</span>
                  <input className="input" value={f.id} onChange={(e) => updateField(i, { id: e.target.value })} />
                </label>
                <label style={{ display: "grid", gap: "0.2rem", flex: "1 1 12rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Label</span>
                  <input className="input" value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} />
                </label>
                <label style={{ display: "grid", gap: "0.2rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Type</span>
                  <select
                    className="input"
                    value={f.type}
                    onChange={(e) => updateField(i, { type: e.target.value as EndOfJobFormFieldType })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", paddingBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(f.required)}
                    onChange={(e) => updateField(i, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button type="button" className="btn secondary" onClick={() => removeField(i)}>
                  Remove
                </button>
              </div>
              {f.type === "select" ? (
                <label style={{ display: "grid", gap: "0.2rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Options (comma-separated)</span>
                  <input
                    className="input"
                    value={(f.options ?? []).join(", ")}
                    onChange={(e) =>
                      updateField(i, {
                        options: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
        {msg ? (
          <span style={{ fontSize: "0.9rem", color: msg === "Saved." ? "var(--good)" : "salmon" }}>{msg}</span>
        ) : null}
      </div>
    </div>
  );
}
