"use client";

import { useState } from "react";

export function JobCostEditor({
  jobId,
  initialCost,
  canEdit,
}: {
  jobId: string;
  initialCost: number;
  canEdit: boolean;
}) {
  const [cost, setCost] = useState(String(initialCost));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <span className="cell-num" title="Cost (read-only)">
        {initialCost.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
      </span>
    );
  }

  async function save() {
    setMsg(null);
    const n = parseFloat(cost.replace(/[^0-9.-]+/g, ""));
    if (Number.isNaN(n) || n < 0) {
      setMsg("Invalid");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cost: n }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error || "Save failed");
      return;
    }
    setMsg("Saved");
    window.location.reload();
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
      <input
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        aria-label="Job cost"
        style={{
          width: "6.5rem",
          padding: "0.3rem 0.4rem",
          borderRadius: 6,
          border: "1px solid #334155",
          background: "#0f172a",
          color: "var(--text)",
          fontSize: "0.82rem",
          textAlign: "right",
        }}
      />
      <button className="btn secondary" type="button" disabled={saving} onClick={save} style={{ fontSize: "0.75rem", padding: "0.35rem 0.55rem" }}>
        {saving ? "…" : "Save"}
      </button>
      {msg && <span style={{ fontSize: "0.72rem", color: msg === "Saved" ? "var(--good)" : "#f87171" }}>{msg}</span>}
    </div>
  );
}
