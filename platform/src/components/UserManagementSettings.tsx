"use client";

import { useEffect, useState } from "react";
import { Role } from "@prisma/client";

type Row = {
  id: string;
  email: string;
  role: Role;
  salespersonId: string | null;
  salespersonName: string | null;
};

export function UserManagementSettings({
  salespeople,
}: {
  salespeople: { id: string; name: string }[];
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(Role.ADMIN);
  const [spId, setSpId] = useState("");

  async function load() {
    const res = await fetch("/api/admin/users");
    const j = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(j.users)) setRows(j.users);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createUser() {
    setMsg(null);
    setBusy(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        password,
        role,
        salespersonId: role === Role.SALESMAN ? spId || null : null,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(typeof j.error === "string" ? j.error : "Could not create user");
      return;
    }
    setEmail("");
    setPassword("");
    setSpId("");
    setMsg("User created.");
    await load();
  }

  async function patchUser(id: string, body: { role?: Role; salespersonId?: string | null; newPassword?: string }) {
    setMsg(null);
    setBusy(true);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(typeof j.error === "string" ? j.error : "Update failed");
      return;
    }
    setMsg("Saved.");
    await load();
  }

  async function deleteUser(id: string, email: string) {
    setMsg(null);
    const ok = window.confirm(`Delete user "${email}"? This cannot be undone.`);
    if (!ok) return;

    setBusy(true);
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setMsg(typeof j.error === "string" ? j.error : "Delete failed");
      return;
    }
    setMsg("User deleted.");
    await load();
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
        Create logins, assign <strong>HR</strong> for payroll-only access, <strong>Admin</strong> for day-to-day ops,{" "}
        <strong>Account manager</strong> linked to a rep name, or <strong>Super admin</strong> for settings and user control.
      </p>

      <div className="card" style={{ padding: "1rem", background: "rgba(0,0,0,0.2)" }}>
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Add user</h3>
        <div className="filter-bar" style={{ alignItems: "flex-end" }}>
          <label>
            Email
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </label>
          <label>
            Password (min 8)
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>
            Role
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value={Role.HR}>HR</option>
              <option value={Role.ADMIN}>Admin</option>
              <option value={Role.SALESMAN}>Account manager</option>
              <option value={Role.SUPER_ADMIN}>Super admin</option>
            </select>
          </label>
          {role === Role.SALESMAN && (
            <label>
              Salesperson
              <select className="input" value={spId} onChange={(e) => setSpId(e.target.value)}>
                <option value="">Select…</option>
                {salespeople.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="btn" type="button" disabled={busy || !email.trim() || !password} onClick={() => void createUser()}>
            Create
          </button>
        </div>
      </div>

      {msg && (
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
          {msg}
        </p>
      )}

      <div>
        <table className="table table-data">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Salesperson</th>
              <th style={{ minWidth: "16rem" }}>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <UserRow key={u.id} u={u} salespeople={salespeople} busy={busy} onPatch={patchUser} onDelete={deleteUser} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({
  u,
  salespeople,
  busy,
  onPatch,
  onDelete,
}: {
  u: Row;
  salespeople: { id: string; name: string }[];
  busy: boolean;
  onPatch: (id: string, body: { role?: Role; salespersonId?: string | null; newPassword?: string }) => Promise<void>;
  onDelete: (id: string, email: string) => Promise<void>;
}) {
  const [role, setRole] = useState(u.role);
  const [spId, setSpId] = useState(u.salespersonId ?? "");
  const [pw, setPw] = useState("");

  return (
    <tr>
      <td className="cell-strong">{u.email}</td>
      <td>
        <select className="input" style={{ minWidth: 130 }} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value={Role.HR}>HR</option>
          <option value={Role.ADMIN}>Admin</option>
          <option value={Role.SALESMAN}>Account manager</option>
          <option value={Role.SUPER_ADMIN}>Super admin</option>
        </select>
      </td>
      <td>{u.salespersonName ?? "—"}</td>
      <td>
        <div style={{ display: "grid", gap: 6 }}>
          {role === Role.SALESMAN && (
            <select className="input" value={spId} onChange={(e) => setSpId(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="">Select rep…</option>
              {salespeople.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <input
            className="input"
            type="password"
            placeholder="New password (optional)"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                void onPatch(u.id, {
                  role,
                  salespersonId: role === Role.SALESMAN ? spId || null : null,
                  newPassword: pw.trim() || undefined,
                }).then(() => setPw(""))
              }
            >
              Save changes
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              style={{ background: "#7f1d1d", color: "#fee2e2" }}
              onClick={() => void onDelete(u.id, u.email)}
            >
              Delete user
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}
