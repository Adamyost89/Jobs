"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeStatusBadgeKey } from "@/lib/status-badge-colors";

type ColorRow = {
  key: string;
  label: string;
  background: string;
  text: string;
  border: string;
  isDefault: boolean;
};

type ApiResponse = {
  entries?: ColorRow[];
  defaults?: ColorRow[];
  error?: string;
};

function blankRow(): ColorRow {
  return {
    key: "",
    label: "",
    background: "rgba(59, 130, 246, 0.15)",
    text: "#93c5fd",
    border: "rgba(59, 130, 246, 0.35)",
    isDefault: false,
  };
}

function mergeRows(defaults: ColorRow[], entries: ColorRow[]): ColorRow[] {
  const byKey = new Map(entries.map((row) => [normalizeStatusBadgeKey(row.key), row] as const));
  const base = defaults.map((d) => {
    const k = normalizeStatusBadgeKey(d.key);
    const current = byKey.get(k);
    return current ? { ...current, isDefault: true } : d;
  });
  const defaultKeys = new Set(base.map((row) => normalizeStatusBadgeKey(row.key)));
  const customs = entries.filter((row) => !defaultKeys.has(normalizeStatusBadgeKey(row.key)));
  return [...base, ...customs];
}

export function StatusBadgeColorSettings() {
  const [rows, setRows] = useState<ColorRow[]>([]);
  const [defaults, setDefaults] = useState<ColorRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      setMsg(null);
      const res = await fetch("/api/admin/status-badge-colors");
      const j = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!alive) return;
      if (!res.ok) {
        setRows([blankRow()]);
        setDefaults([]);
        setBusy(false);
        setMsg(typeof j.error === "string" ? j.error : "Could not load status colors.");
        return;
      }
      const defaultRows = Array.isArray(j.defaults) ? j.defaults : [];
      const entryRows = Array.isArray(j.entries) ? j.entries : [];
      const merged = mergeRows(defaultRows, entryRows);
      setDefaults(defaultRows);
      setRows(merged.length > 0 ? merged : [blankRow()]);
      setBusy(false);
    })().catch((e: unknown) => {
      if (!alive) return;
      setRows([blankRow()]);
      setDefaults([]);
      setBusy(false);
      setMsg(e instanceof Error ? e.message : "Could not load status colors.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const configuredCount = useMemo(
    () => rows.filter((r) => r.key.trim() && r.background.trim() && r.text.trim() && r.border.trim()).length,
    [rows]
  );

  function setRow(idx: number, patch: Partial<ColorRow>) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        if (patch.key !== undefined) {
          next.label = normalizeStatusBadgeKey(patch.key);
        }
        return next;
      })
    );
  }

  function addCustomRow() {
    setRows((prev) => [...prev, blankRow()]);
  }

  function removeRow(idx: number) {
    setRows((prev) => {
      const row = prev[idx];
      if (!row || row.isDefault) return prev;
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [blankRow()];
    });
  }

  function resetToDefaults() {
    const next = defaults.length > 0 ? defaults : [];
    setRows(next.length ? next : [blankRow()]);
    setMsg("Reset local editor to default rows. Save to apply.");
  }

  async function save() {
    setMsg(null);
    setSaving(true);
    const entries = rows
      .map((r) => ({
        key: normalizeStatusBadgeKey(r.key),
        background: r.background.trim(),
        text: r.text.trim(),
        border: r.border.trim(),
      }))
      .filter((r) => r.key && r.background && r.text && r.border);

    const res = await fetch("/api/admin/status-badge-colors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    const j = (await res.json().catch(() => ({}))) as ApiResponse;
    setSaving(false);
    if (!res.ok) {
      setMsg(typeof j.error === "string" ? j.error : "Could not save status colors.");
      return;
    }
    const defaultRows = Array.isArray(j.defaults) ? j.defaults : defaults;
    const entryRows = Array.isArray(j.entries) ? j.entries : [];
    const merged = mergeRows(defaultRows, entryRows);
    setDefaults(defaultRows);
    setRows(merged.length > 0 ? merged : [blankRow()]);
    setMsg("Saved.");
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <p className="help" style={{ margin: 0 }}>
        Colors are shared for all users. Matching checks the displayed status text first (for example{" "}
        <code>PAID &amp; CLOSED</code>, <code>INVOICE SENT</code>), then falls back to lifecycle status.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Status / stage key</th>
              <th>Background</th>
              <th>Text</th>
              <th>Border</th>
              <th>Preview</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`status-color-${idx}`}>
                <td>
                  <input
                    className="input"
                    maxLength={80}
                    disabled={busy || saving || row.isDefault}
                    value={row.key}
                    placeholder="PAID & CLOSED"
                    onChange={(e) => setRow(idx, { key: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    disabled={busy || saving}
                    value={row.background}
                    placeholder="rgba(34, 197, 94, 0.12)"
                    onChange={(e) => setRow(idx, { background: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="color"
                    disabled={busy || saving}
                    value={row.text.startsWith("#") ? row.text : "#93c5fd"}
                    onChange={(e) => setRow(idx, { text: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    disabled={busy || saving}
                    value={row.border}
                    placeholder="rgba(59, 130, 246, 0.35)"
                    onChange={(e) => setRow(idx, { border: e.target.value })}
                  />
                </td>
                <td>
                  <span
                    className="status-pill"
                    style={{
                      background: row.background,
                      color: row.text,
                      border: `1px solid ${row.border}`,
                    }}
                  >
                    {row.key || "Status"}
                  </span>
                </td>
                <td style={{ width: 100 }}>
                  {row.isDefault ? (
                    <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Default</span>
                  ) : (
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={busy || saving}
                      onClick={() => removeRow(idx)}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn secondary" type="button" disabled={busy || saving} onClick={addCustomRow}>
          Add custom stage
        </button>
        <button className="btn secondary" type="button" disabled={busy || saving} onClick={resetToDefaults}>
          Reset editor to defaults
        </button>
        <button className="btn" type="button" disabled={busy || saving} onClick={() => void save()}>
          {saving ? "Saving..." : "Save status colors"}
        </button>
        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{configuredCount} configured row(s).</span>
      </div>

      {msg && (
        <p style={{ margin: 0, fontSize: "0.9rem", color: msg === "Saved." ? "var(--good)" : "salmon" }} role="status">
          {msg}
        </p>
      )}
    </div>
  );
}
