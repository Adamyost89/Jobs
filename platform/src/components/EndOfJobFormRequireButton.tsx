"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EndOfJobFormRequireButton({ jobId, jobNumber }: { jobId: string; jobNumber: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endOfJobFormRequiredAt: new Date().toISOString() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(typeof j.error === "string" ? j.error : "Request failed");
        return;
      }
      router.refresh();
    } catch {
      setMsg("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.35rem" }}>
      <button type="button" className="btn" disabled={busy} onClick={() => void onClick()}>
        {busy ? "Working…" : "Require checklist now"}
      </button>
      {msg ? <p style={{ margin: 0, fontSize: "0.85rem", color: "salmon" }}>{msg}</p> : null}
      <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
        Admin trigger: sets the same requirement as when ProLine stage matches your configured trigger (e.g.{" "}
        <strong>End of Job Checklist</strong>) for job {jobNumber}.
      </p>
    </div>
  );
}
