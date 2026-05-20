"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RemoveEndOfJobFormButton({
  jobId,
  jobNumber,
  view,
}: {
  jobId: string;
  jobNumber: string;
  view: "pending" | "submitted";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    const detail =
      view === "pending"
        ? "This clears the checklist requirement so the job leaves Pending and commission payouts are no longer blocked by the form. If ProLine stage still matches your trigger, the requirement may be set again on the next sync."
        : "This clears the submitted checklist and saved responses. Automations already sent (e.g. Zap) are not undone.";
    const ok = window.confirm(
      `Remove job ${jobNumber} from the ${view === "pending" ? "pending" : "submitted"} forms list?\n\n${detail}`
    );
    if (!ok) return;

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/end-of-job-form`, { method: "DELETE" });
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
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: "0.25rem" }}>
      <button
        type="button"
        className="btn secondary"
        disabled={busy}
        onClick={() => void onClick()}
        title="Remove from forms list (admin)"
      >
        {busy ? "Removing…" : "Remove"}
      </button>
      {msg ? (
        <span style={{ fontSize: "0.78rem", color: "salmon", maxWidth: "12rem" }}>{msg}</span>
      ) : null}
    </span>
  );
}
