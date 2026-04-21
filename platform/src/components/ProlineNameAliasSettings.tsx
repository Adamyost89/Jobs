"use client";

import { useEffect, useMemo, useState } from "react";

type AliasEntry = { source: string; target: string };

type ApiResponse = {
  entries?: AliasEntry[];
  error?: string;
};

function blankEntry(): AliasEntry {
  return { source: "", target: "" };
}

export function ProlineNameAliasSettings() {
  const [rows, setRows] = useState<AliasEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      setMsg(null);
      const res = await fetch("/api/admin/proline-name-aliases");
      const j = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!alive) return;
      if (!res.ok) {
        setMsg(typeof j.error === "string" ? j.error : "Could not load aliases.");
        setRows([blankEntry()]);
        setBusy(false);
        return;
      }
      setRows(j.entries && j.entries.length ? j.entries : [blankEntry()]);
      setBusy(false);
    })().catch((e: unknown) => {
      if (!alive) return;
      setRows([blankEntry()]);
      setBusy(false);
      setMsg(e instanceof Error ? e.message : "Could not load aliases.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const normalizedCount = useMemo(
    () =>
      rows.filter((r) => {
        const s = r.source.trim();
        const t = r.target.trim();
        return s.length > 0 && t.length > 0;
      }).length,
    [rows]
  );

  function setRow(idx: number, patch: Partial<AliasEntry>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRow(idx: number) {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [blankEntry()];
    });
  }

  function addRow() {
    setRows((prev) => [...prev, blankEntry()]);
  }

  async function save() {
    setMsg(null);
    setSaving(true);
    const entries = rows
      .map((r) => ({ source: r.source.trim(), target: r.target.trim() }))
      .filter((r) => r.source.length > 0 && r.target.length > 0);
    const res = await fetch("/api/admin/proline-name-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    const j = (await res.json().catch(() => ({}))) as ApiResponse;
    setSaving(false);
    if (!res.ok) {
      setMsg(typeof j.error === "string" ? j.error : "Could not save aliases.");
      return;
    }
    setRows(j.entries && j.entries.length ? j.entries : [blankEntry()]);
    setMsg("Saved.");
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <p className="help" style={{ margin: 0 }}>
        Dictate how ProLine names display in-app. Left side is what ProLine sends (full name or user id), right side is
        the exact display name to use (for example: <code>James Swartz</code> → <code>James</code>).
      </p>
      <p className="help" style={{ margin: 0 }}>
        Alias matching is case-insensitive. These aliases are used before <code>PROLINE_USER_MAP</code> and before the
        first-name fallback.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Incoming from ProLine</th>
              <th>Display as</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={`alias-${idx}`}>
                <td>
                  <input
                    className="input"
                    value={r.source}
                    maxLength={160}
                    disabled={busy || saving}
                    placeholder="James Swartz or 1735913165830x499495740739852160"
                    onChange={(e) => setRow(idx, { source: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    value={r.target}
                    maxLength={80}
                    disabled={busy || saving}
                    placeholder="James"
                    onChange={(e) => setRow(idx, { target: e.target.value })}
                  />
                </td>
                <td style={{ width: 60 }}>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={busy || saving}
                    onClick={() => removeRow(idx)}
                    title="Remove row"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn secondary" type="button" disabled={busy || saving} onClick={addRow}>
          Add alias row
        </button>
        <button className="btn" type="button" disabled={busy || saving} onClick={() => void save()}>
          {saving ? "Saving..." : "Save aliases"}
        </button>
        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{normalizedCount} active alias row(s).</span>
      </div>

      {msg && (
        <p style={{ margin: 0, fontSize: "0.9rem", color: msg === "Saved." ? "var(--good)" : "salmon" }} role="status">
          {msg}
        </p>
      )}
    </div>
  );
}
