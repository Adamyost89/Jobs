"use client";

import { useState } from "react";

export function ToggleCutover({ initial }: { initial: boolean }) {
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle() {
    setMsg(null);
    const res = await fetch("/api/admin/cutover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cutoverComplete: !v }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error || "Failed");
      return;
    }
    setV(!!j.cutoverComplete);
    setMsg("Saved.");
  }

  return (
    <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
      <span>Cutover complete: {v ? "yes" : "no"}</span>
      <button className="btn secondary" type="button" onClick={toggle}>
        Toggle
      </button>
      {msg && <span style={{ fontSize: "0.85rem" }}>{msg}</span>}
    </div>
  );
}
