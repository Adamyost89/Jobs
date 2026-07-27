"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  EndOfJobFormConfig,
  EndOfJobFormField,
  EndOfJobFormFieldType,
  EndOfJobFormTriggerConfig,
} from "@/lib/end-of-job-form";

const FIELD_TYPES: EndOfJobFormFieldType[] = ["text", "textarea", "number", "boolean", "select"];

function parseSelectOptionsText(text: string): string[] {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function fieldWithShowIfDraft(
  f: EndOfJobFormField,
  showIfEqualsDraft: Record<string, string>
): EndOfJobFormField {
  if (!f.showIf) return f;
  const draft = showIfEqualsDraft[f.id];
  if (draft === undefined) return f;
  const equals = parseSelectOptionsText(draft);
  if (equals.length === 0) {
    const { showIf: _s, ...rest } = f;
    return rest;
  }
  return { ...f, showIf: { ...f.showIf, equals } };
}

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
  /** Raw textarea text per select field id (avoids eating commas/newlines while typing). */
  const [optionsDraft, setOptionsDraft] = useState<Record<string, string>>({});
  /** Raw textarea text for showIf.equals per field id. */
  const [showIfEqualsDraft, setShowIfEqualsDraft] = useState<Record<string, string>>({});

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
      setOptionsDraft({});
      setShowIfEqualsDraft({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function fieldsForSave(): EndOfJobFormField[] {
    return fields.map((f) => {
      let next = fieldWithShowIfDraft(f, showIfEqualsDraft);
      if (next.type === "select") {
        const draft = optionsDraft[next.id];
        if (draft !== undefined) {
          next = { ...next, options: parseSelectOptionsText(draft) };
        }
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const body = {
        endOfJobFormTrigger: trigger,
        endOfJobForm: { version, fields: fieldsForSave() },
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
      setOptionsDraft({});
      setShowIfEqualsDraft({});
      setFields(fieldsForSave());
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

  function updateField(i: number, patch: Partial<EndOfJobFormField> & { showIf?: EndOfJobFormField["showIf"] | undefined }) {
    setFields((prev) => {
      const next = [...prev];
      const cur = next[i];
      if (!cur) return prev;
      const merged = { ...cur, ...patch };
      if ("showIf" in patch && patch.showIf === undefined) {
        const { showIf: _s, ...rest } = merged;
        next[i] = rest;
      } else {
        next[i] = merged;
      }
      if (patch.type !== undefined && patch.type !== "select") {
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
        <code>END_OF_JOB_FORM_ZAP_URL</code> (optional secret: <code>END_OF_JOB_FORM_ZAP_SECRET</code>). Use{" "}
        <strong>Show only if</strong> on a field to hide it until another field matches one of the listed answers.
        Example: thank-you question when <code>field_5</code> is Unforgettable or Excellent; review QR question when
        the thank-you field is Yes.
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
          fields.map((f, i) => {
            const otherFields = fields.filter((_, idx) => idx !== i);
            const showIfEnabled = Boolean(f.showIf);
            return (
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
                    <input
                      className="input"
                      value={f.label}
                      onChange={(e) => updateField(i, { label: e.target.value })}
                    />
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
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                      Options (one per line; commas allowed in each option)
                    </span>
                    <textarea
                      className="input"
                      rows={Math.min(8, Math.max(3, (f.options ?? []).length))}
                      value={optionsDraft[f.id] ?? (f.options ?? []).join("\n")}
                      onChange={(e) => setOptionsDraft((prev) => ({ ...prev, [f.id]: e.target.value }))}
                      onBlur={(e) => {
                        updateField(i, { options: parseSelectOptionsText(e.target.value) });
                        setOptionsDraft((prev) => {
                          const next = { ...prev };
                          delete next[f.id];
                          return next;
                        });
                      }}
                    />
                  </label>
                ) : null}

                <div
                  style={{
                    display: "grid",
                    gap: "0.45rem",
                    paddingTop: "0.25rem",
                    borderTop: "1px solid var(--border, rgba(255,255,255,0.08))",
                  }}
                >
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <input
                      type="checkbox"
                      checked={showIfEnabled}
                      disabled={otherFields.length === 0}
                      onChange={(e) => {
                        if (!e.target.checked) {
                          updateField(i, { showIf: undefined });
                          setShowIfEqualsDraft((prev) => {
                            const next = { ...prev };
                            delete next[f.id];
                            return next;
                          });
                          return;
                        }
                        const first = otherFields[0];
                        if (!first) return;
                        updateField(i, { showIf: { fieldId: first.id, equals: [] } });
                      }}
                    />
                    <span style={{ fontSize: "0.9rem" }}>Show only if…</span>
                    {otherFields.length === 0 ? (
                      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>(add another field first)</span>
                    ) : null}
                  </label>
                  {showIfEnabled && f.showIf ? (
                    <div style={{ display: "grid", gap: "0.45rem", maxWidth: "28rem" }}>
                      <label style={{ display: "grid", gap: "0.2rem" }}>
                        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>When this field equals…</span>
                        <select
                          className="input"
                          value={f.showIf.fieldId}
                          onChange={(e) =>
                            updateField(i, {
                              showIf: { fieldId: e.target.value, equals: f.showIf?.equals ?? [] },
                            })
                          }
                        >
                          {otherFields.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.id}
                              {o.label ? ` — ${o.label}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ display: "grid", gap: "0.2rem" }}>
                        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                          Any of these answers (one per line)
                        </span>
                        <textarea
                          className="input"
                          rows={Math.min(6, Math.max(2, (f.showIf.equals ?? []).length || 2))}
                          value={showIfEqualsDraft[f.id] ?? (f.showIf.equals ?? []).join("\n")}
                          onChange={(e) =>
                            setShowIfEqualsDraft((prev) => ({ ...prev, [f.id]: e.target.value }))
                          }
                          onBlur={(e) => {
                            const equals = parseSelectOptionsText(e.target.value);
                            updateField(i, {
                              showIf: { fieldId: f.showIf!.fieldId, equals },
                            });
                            setShowIfEqualsDraft((prev) => {
                              const next = { ...prev };
                              delete next[f.id];
                              return next;
                            });
                          }}
                          placeholder={"Unforgettable\nExcellent"}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
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
