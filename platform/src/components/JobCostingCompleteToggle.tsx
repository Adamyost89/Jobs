"use client";

import { useState } from "react";

export function JobCostingCompleteToggle({
  jobId,
  initial,
  canEdit,
}: {
  jobId: string;
  initial: boolean;
  canEdit: boolean;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return <span className="cell-muted">{initial ? "Yes" : "No"}</span>;
  }

  async function patch(next: boolean) {
    setBusy(true);
    const res = await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ costingComplete: next }),
    });
    setBusy(false);
    if (!res.ok) return;
    setV(next);
    window.location.reload();
  }

  return (
    <label className="filter-check" style={{ cursor: busy ? "wait" : "pointer", padding: 0, margin: 0 }}>
      <input type="checkbox" checked={v} disabled={busy} onChange={(e) => void patch(e.target.checked)} />
      <span style={{ fontSize: "0.82rem" }}>Costing done</span>
    </label>
  );
}
