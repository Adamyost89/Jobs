"use client";

import { useState } from "react";

type Props = {
  years: number[];
  salespeople: { id: string; name: string }[];
};

export function RecalculateCommissionsButton({ years, salespeople }: Props) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(years.includes(currentYear) ? currentYear : (years[years.length - 1] ?? currentYear));
  const [salespersonId, setSalespersonId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    const who = salespeople.find((s) => s.id === salespersonId)?.name;
    const scope = who ? `${who}'s ${year} jobs` : `every ${year} job`;
    if (!window.confirm(`Recalculate commissions on ${scope}? Owed amounts will be overwritten (override-locked lines are kept).`)) {
      return;
    }
    setBusy(true);
    setMsg(null);
    let cursor: string | null = null;
    let done = 0;
    let total: number | undefined;
    const failed: string[] = [];
    try {
      do {
        const res = await fetch("/api/admin/commissions/recalculate-year", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, salespersonId: salespersonId || null, cursor }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          processed?: number;
          failed?: string[];
          nextCursor?: string | null;
          total?: number;
          error?: unknown;
        };
        if (!res.ok) {
          setMsg(`Stopped after ${done} jobs: ${typeof j.error === "string" ? j.error : "request failed"}.`);
          return;
        }
        total ??= j.total;
        done += j.processed ?? 0;
        failed.push(...(j.failed ?? []));
        cursor = j.nextCursor ?? null;
        setMsg(`Recalculated ${done}${total !== undefined ? ` of ${total}` : ""} jobs...`);
      } while (cursor);
      setMsg(
        `Done. Recalculated ${done} jobs.${failed.length ? ` Failed: ${failed.join(", ")}.` : ""}`
      );
    } catch {
      setMsg(`Network error after ${done} jobs. Run it again to finish.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: "grid", gap: "0.5rem" }}>
      <div style={{ display: "grid", gap: "0.2rem" }}>
        <strong style={{ fontSize: "0.9rem" }}>Recalculate commissions</strong>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
          Re-runs the commission plan on every job in the year (or only one salesperson&apos;s jobs). Use after changing
          a plan or fixing commission math.
        </p>
      </div>
      <div className="form-row" style={{ alignItems: "end" }}>
        <label className="form-field">
          <span>Year</span>
          <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={busy}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Jobs sold by</span>
          <select className="input" value={salespersonId} onChange={(e) => setSalespersonId(e.target.value)} disabled={busy}>
            <option value="">Everyone</option>
            {salespeople.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="button" onClick={run} disabled={busy}>
          {busy ? "Recalculating..." : "Recalculate"}
        </button>
      </div>
      {msg ? <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>{msg}</p> : null}
    </div>
  );
}
