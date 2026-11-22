"use client";

import { useEffect, useState } from "react";
import { parseMoneyInputString } from "@/lib/currency";

type SalespersonOption = { id: string; name: string; active: boolean };

export function AddJobCommissionPanel({
  jobId,
  jobNumber,
  onClose,
}: {
  jobId: string;
  jobNumber: string;
  onClose: () => void;
}) {
  const [people, setPeople] = useState<SalespersonOption[]>([]);
  const [salespersonId, setSalespersonId] = useState("");
  const [owed, setOwed] = useState("");
  const [paid, setPaid] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingPeople, setLoadingPeople] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/salespeople");
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) setMsg(typeof j.error === "string" ? j.error : "Could not load salespeople.");
          return;
        }
        const rows = Array.isArray(j.salespeople) ? (j.salespeople as SalespersonOption[]) : [];
        if (cancelled) return;
        setPeople(rows);
        const first = rows.find((p) => p.active) ?? rows[0];
        if (first) setSalespersonId(first.id);
      } catch {
        if (!cancelled) setMsg("Could not load salespeople.");
      } finally {
        if (!cancelled) setLoadingPeople(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    if (busy) return;
    setMsg(null);
    if (!salespersonId) {
      setMsg("Choose a salesperson.");
      return;
    }
    const owedAmount = parseMoneyInputString(owed);
    if (owedAmount == null || owedAmount < 0) {
      setMsg("Enter the commission amount to add.");
      return;
    }
    const paidRaw = paid.trim();
    const paidAmount = paidRaw === "" ? 0 : parseMoneyInputString(paidRaw);
    if (paidAmount == null || paidAmount < 0) {
      setMsg("Already paid must be a valid amount.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/commissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salespersonId, owedAmount, paidAmount }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(typeof j.error === "string" ? j.error : "Could not add the commission.");
        return;
      }
      window.location.reload();
    } catch {
      setMsg("Network error adding the commission.");
    } finally {
      setBusy(false);
    }
  }

  const active = people.filter((p) => p.active);
  const inactive = people.filter((p) => !p.active);

  return (
    <div className="card" style={{ margin: "0.35rem 0.7rem 0.8rem", padding: "0.9rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <strong>Add commission on job {jobNumber}</strong>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)", maxWidth: 640 }}>
            Adds this amount on top of any commission already on this job for that person and locks it. Customer
            payments that come in later still earn commission on the new cash.
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
          Close
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.65rem 0.8rem",
          marginTop: "0.85rem",
        }}
      >
        <label>
          Salesperson
          <select
            className="input"
            value={salespersonId}
            disabled={loadingPeople || busy}
            onChange={(e) => setSalespersonId(e.target.value)}
          >
            {people.length === 0 ? <option value="">No salespeople</option> : null}
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {inactive.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (inactive)
              </option>
            ))}
          </select>
        </label>
        <label>
          Commission to add
          <input
            className="input"
            type="text"
            inputMode="decimal"
            value={owed}
            disabled={busy}
            placeholder="0.00"
            aria-label="Commission amount to add"
            onChange={(e) => setOwed(e.target.value)}
          />
        </label>
        <label>
          Already paid
          <input
            className="input"
            type="text"
            inputMode="decimal"
            value={paid}
            disabled={busy}
            placeholder="0.00"
            aria-label="Amount of this commission already paid"
            onChange={(e) => setPaid(e.target.value)}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: "0.55rem", marginTop: "0.9rem", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => void submit()} disabled={busy || loadingPeople}>
          {busy ? "Adding…" : "Add commission"}
        </button>
        {msg ? (
          <span style={{ fontSize: "0.82rem", color: "#f87171" }} role="alert">
            {msg}
          </span>
        ) : null}
      </div>
    </div>
  );
}
