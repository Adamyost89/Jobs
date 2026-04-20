"use client";

import { useState } from "react";
import type { SalesKind } from "@/lib/salespeople-kind-db";

export type SalesTeamRow = {
  id: string;
  name: string;
  active: boolean;
  kind: SalesKind;
};

export function SalesTeamSettings({ initial }: { initial: SalesTeamRow[] }) {
  const [rows, setRows] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function patchRow(id: string, body: { kind?: SalesKind; active?: boolean }) {
    setMsg(null);
    setBusy(true);
    const res = await fetch("/api/admin/salespeople", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(typeof j.error === "string" ? j.error : "Something went wrong");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...j.salesperson } : r)));
    setMsg("Saved.");
  }

  async function addPerson() {
    const name = newName.trim();
    if (!name) return;
    setMsg(null);
    setBusy(true);
    const res = await fetch("/api/admin/salespeople", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(typeof j.error === "string" ? j.error : "Could not add");
      return;
    }
    if (j.salesperson) {
      setRows((prev) => [...prev, j.salesperson].sort((a, b) => a.name.localeCompare(b.name)));
    }
    setNewName("");
    const addedName = typeof j?.salesperson?.name === "string" ? j.salesperson.name : name;
    setMsg(`${addedName} added. Add them to each year’s commission plan if they earn commission.`);
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <p className="help" style={{ margin: 0 }}>
        <strong>Inactive</strong> means they won&apos;t get new commission math and won&apos;t show up for new work
        the same way as active folks. You can turn them back on anytime. <strong>Managers</strong> (like a sales
        manager) always count as &quot;every job&quot; for commissions even if a year&apos;s plan says &quot;only their
        jobs&quot; — that&apos;s so overrides behave predictably.
      </p>

      <div className="form-row" style={{ alignItems: "flex-end", gap: "0.75rem" }}>
        <label className="form-field" style={{ flex: "1 1 200px", margin: 0 }}>
          <span>Add someone new</span>
          <input
            className="input"
            placeholder="First name (e.g. Chris)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={80}
          />
        </label>
        <button className="btn" type="button" disabled={busy || !newName.trim()} onClick={() => void addPerson()}>
          Add to team
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Active</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ opacity: r.active ? 1 : 0.65 }}>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
                <td>
                  <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={r.active}
                      disabled={busy}
                      onChange={(e) => void patchRow(r.id, { active: e.target.checked })}
                    />
                    <span>{r.active ? "Active" : "Inactive"}</span>
                  </label>
                </td>
                <td>
                  <select
                    className="input input-narrow"
                    value={r.kind}
                    disabled={busy}
                    onChange={(e) => void patchRow(r.id, { kind: e.target.value as SalesKind })}
                  >
                    <option value="REP">Sales rep</option>
                    <option value="MANAGER">Sales manager</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {msg && (
        <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--good)" }} role="status">
          {msg}
        </p>
      )}
    </div>
  );
}
